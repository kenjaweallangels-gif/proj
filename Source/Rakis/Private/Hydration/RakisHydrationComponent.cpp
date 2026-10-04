#include "Hydration/RakisHydrationComponent.h"

#include "Engine/DirectionalLight.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/Actor.h"
#include "Hydration/RakisHydrationTuning.h"
#include "Rakis.h"
#include "TimerManager.h"

URakisHydrationComponent::URakisHydrationComponent()
{
	PrimaryComponentTick.bCanEverTick = false;
}

void URakisHydrationComponent::BeginPlay()
{
	Super::BeginPlay();

	const URakisHydrationTuning* Tuning = URakisHydrationTuning::Get();
	Moisture01 = Tuning->InitialMoisture;
	bMaskSealed = bStartMaskSealed;

	if (UWorld* World = GetWorld())
	{
		LastUpdateTime = World->GetTimeSeconds();
		World->GetTimerManager().SetTimer(UpdateTimer, this, &URakisHydrationComponent::UpdateHydration,
			FMath::Max(0.05f, Tuning->UpdateInterval), true);
	}

	LastBroadcastMoisture = Moisture01;
	OnMoistureChanged.Broadcast(Moisture01);
}

void URakisHydrationComponent::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().ClearTimer(UpdateTimer);
	}
	Super::EndPlay(EndPlayReason);
}

void URakisHydrationComponent::SetMaskSealed(bool bSealed)
{
	bMaskSealed = bSealed;
}

void URakisHydrationComponent::SetInterior(bool bInInterior)
{
	bForcedInterior = bInInterior;
}

void URakisHydrationComponent::AddMoisture(float Delta01)
{
	Moisture01 = FMath::Clamp(Moisture01 + Delta01, 0.f, 1.f);
	LastBroadcastMoisture = Moisture01;
	OnMoistureChanged.Broadcast(Moisture01);
}

float URakisHydrationComponent::ComputeMoistureDelta(ERakisExposure InExposure, bool bRunning, bool bSealed, float DeltaSeconds,
	float SunDrainPerMinute, float ShadeRecoverPerMinute, float RunMultiplier, float MaskSealedFactor, float InteriorRecoverPerMinute)
{
	const float Minutes = FMath::Max(0.f, DeltaSeconds) / 60.f;
	switch (InExposure)
	{
	case ERakisExposure::Interior:
		return InteriorRecoverPerMinute * Minutes;
	case ERakisExposure::Shade:
		// В тени бег не даёт восстанавливаться, но и не сушит.
		return bRunning ? 0.f : ShadeRecoverPerMinute * Minutes;
	case ERakisExposure::Sun:
	default:
	{
		float Drain = SunDrainPerMinute;
		if (bRunning) { Drain *= RunMultiplier; }
		if (bSealed) { Drain *= MaskSealedFactor; }
		return -Drain * Minutes;
	}
	}
}

ADirectionalLight* URakisHydrationComponent::FindSun()
{
	if (CachedSun.IsValid())
	{
		return CachedSun.Get();
	}

	UWorld* World = GetWorld();
	if (!World || World->GetTimeSeconds() < NextSunSearchTime)
	{
		return nullptr;
	}
	// Поиск дорогой — не чаще раза в 5 с, пока солнце не найдено (например, в сиетче его может не быть).
	NextSunSearchTime = World->GetTimeSeconds() + 5.f;

	ADirectionalLight* First = nullptr;
	for (TActorIterator<ADirectionalLight> It(World); It; ++It)
	{
		if (It->ActorHasTag(SunTag))
		{
			CachedSun = *It;
			return *It;
		}
		if (!First)
		{
			First = *It;
		}
	}
	CachedSun = First;
	return First;
}

bool URakisHydrationComponent::IsOverlappingInteriorVolume() const
{
	const AActor* Owner = GetOwner();
	if (!Owner || InteriorTag.IsNone())
	{
		return false;
	}
	TArray<AActor*> Overlapping;
	Owner->GetOverlappingActors(Overlapping);
	for (const AActor* Other : Overlapping)
	{
		if (Other && Other->ActorHasTag(InteriorTag))
		{
			return true;
		}
	}
	return false;
}

bool URakisHydrationComponent::TraceSunBlocked(const ADirectionalLight* Sun) const
{
	const AActor* Owner = GetOwner();
	UWorld* World = GetWorld();
	if (!Owner || !World || !Sun)
	{
		return false;
	}

	const URakisHydrationTuning* Tuning = URakisHydrationTuning::Get();
	// Направленный свет светит вдоль своего Forward; к солнцу — против него.
	const FVector ToSun = -Sun->GetActorForwardVector();
	const FVector Start = Owner->GetActorLocation() + FVector(0.f, 0.f, TraceHeightOffset);
	const FVector End = Start + ToSun * Tuning->SunTraceLength;

	FCollisionQueryParams Params(SCENE_QUERY_STAT(RakisSunTrace), false, Owner);
	return World->LineTraceTestByChannel(Start, End, ECC_Visibility, Params);
}

void URakisHydrationComponent::UpdateHydration()
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}

	const URakisHydrationTuning* Tuning = URakisHydrationTuning::Get();
	const float Now = World->GetTimeSeconds();
	const float Dt = Now - LastUpdateTime;
	LastUpdateTime = Now;

	// 1) Где мы: интерьер → тень → солнце.
	ERakisExposure NewExposure = ERakisExposure::Sun;
	ADirectionalLight* Sun = FindSun();
	if (bForcedInterior || !Sun || IsOverlappingInteriorVolume())
	{
		NewExposure = ERakisExposure::Interior;
	}
	else if (TraceSunBlocked(Sun))
	{
		NewExposure = ERakisExposure::Shade;
	}

	const bool bWasShade = IsInShade();
	Exposure = NewExposure;
	if (bWasShade != IsInShade())
	{
		OnShadeChanged.Broadcast(IsInShade());
	}

	// 2) Жара плавно следует за целевой.
	float TargetHeat = Tuning->HeatInSun;
	if (Exposure == ERakisExposure::Shade) { TargetHeat = Tuning->HeatInShade; }
	else if (Exposure == ERakisExposure::Interior) { TargetHeat = Tuning->HeatInterior; }
	Heat01 = FMath::FInterpConstantTo(Heat01, TargetHeat, Dt, Tuning->HeatResponsePerSecond);

	// 3) Влага.
	const float Delta = ComputeMoistureDelta(Exposure, bExerting, bMaskSealed, Dt,
		Tuning->SunDrainPerMinute, Tuning->ShadeRecoverPerMinute, Tuning->RunMultiplier,
		Tuning->MaskSealedFactor, Tuning->InteriorRecoverPerMinute);
	Moisture01 = FMath::Clamp(Moisture01 + Delta, 0.f, 1.f);

	if (FMath::Abs(Moisture01 - LastBroadcastMoisture) >= Tuning->BroadcastEpsilon
		|| (Moisture01 <= 0.f && LastBroadcastMoisture > 0.f)
		|| (Moisture01 >= 1.f && LastBroadcastMoisture < 1.f))
	{
		LastBroadcastMoisture = Moisture01;
		OnMoistureChanged.Broadcast(Moisture01);
	}
}
