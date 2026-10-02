#include "Worm/RakisWorm.h"

#include "Components/AudioComponent.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/SceneComponent.h"
#include "Components/SplineComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Core/RakisSettings.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "GameFramework/Pawn.h"
#include "Gameplay/RakisAssetUtils.h"
#include "Kismet/GameplayStatics.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "Materials/MaterialParameterCollection.h"
#include "Materials/MaterialParameterCollectionInstance.h"
#include "NiagaraComponent.h"
#include "NiagaraFunctionLibrary.h"
#include "NiagaraSystem.h"
#include "Noise/RakisNoiseSubsystem.h"
#include "Noise/RakisNoiseTuning.h"
#include "Player/RakisCharacter.h"
#include "Player/RakisPlayerController.h"
#include "Rakis.h"
#include "Sound/SoundBase.h"
#include "TimerManager.h"
#include "UObject/ConstructorHelpers.h"
#include "Worm/RakisWormTuning.h"

namespace RakisWorm
{
	static constexpr int32 PetalCount = 3;
	static constexpr int32 MaxRingSandfall = 4;
	static const FName IntensityParam(TEXT("User.Intensity"));
	static const FName DistanceParam(TEXT("Distance"));
	static const FName ThreatParam(TEXT("Threat"));
	static const FName ThumperSource(TEXT("Thumper"));

	/** Поворот «меш вытянут по Z» → «по X» (FRotator pitch −90 переводит +Z в +X). */
	static const FQuat ZToXAxis = FQuat(FRotator(-90.f, 0.f, 0.f));
}

ARakisWorm::ARakisWorm()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.bStartWithTickEnabled = true;
	PrimaryActorTick.TickInterval = 1.f / 30.f;

	SceneRoot = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	SetRootComponent(SceneRoot);
	SceneRoot->SetMobility(EComponentMobility::Movable);

	BodySpline = CreateDefaultSubobject<USplineComponent>(TEXT("BodySpline"));
	BodySpline->SetupAttachment(SceneRoot);
	BodySpline->SetMobility(EComponentMobility::Movable);

	BodySegments = CreateDefaultSubobject<UInstancedStaticMeshComponent>(TEXT("BodySegments"));
	BodySegments->SetupAttachment(SceneRoot);
	BodySegments->SetMobility(EComponentMobility::Movable);
	BodySegments->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	BodySegments->SetGenerateOverlapEvents(false);
	BodySegments->SetCanEverAffectNavigation(false);
	BodySegments->SetCastShadow(true);
	BodySegments->NumCustomDataFloats = 1; // 0..1 — позиция кольца вдоль тела (вариации материала)

	HeadPivot = CreateDefaultSubobject<USceneComponent>(TEXT("HeadPivot"));
	HeadPivot->SetupAttachment(SceneRoot);
	HeadPivot->SetMobility(EComponentMobility::Movable);

	HeadMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("HeadMesh"));
	HeadMesh->SetupAttachment(HeadPivot);
	HeadMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	HeadMesh->SetGenerateOverlapEvents(false);
	HeadMesh->SetCanEverAffectNavigation(false);

	for (int32 i = 0; i < RakisWorm::PetalCount; ++i)
	{
		USceneComponent* Pivot = CreateDefaultSubobject<USceneComponent>(*FString::Printf(TEXT("PetalPivot%d"), i));
		Pivot->SetupAttachment(HeadPivot);
		PetalPivots.Add(Pivot);

		UStaticMeshComponent* Petal = CreateDefaultSubobject<UStaticMeshComponent>(*FString::Printf(TEXT("Petal%d"), i));
		Petal->SetupAttachment(Pivot);
		Petal->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Petal->SetGenerateOverlapEvents(false);
		Petal->SetCanEverAffectNavigation(false);
		PetalMeshes.Add(Petal);
	}

	SandWaveFX = CreateDefaultSubobject<UNiagaraComponent>(TEXT("SandWaveFX"));
	SandWaveFX->SetupAttachment(SceneRoot);
	SandWaveFX->SetAutoActivate(false);
	SandWaveFX->SetUsingAbsoluteLocation(true);
	SandWaveFX->SetUsingAbsoluteRotation(true);

	RockHopFX = CreateDefaultSubobject<UNiagaraComponent>(TEXT("RockHopFX"));
	RockHopFX->SetupAttachment(SceneRoot);
	RockHopFX->SetAutoActivate(false);
	RockHopFX->SetUsingAbsoluteLocation(true);
	RockHopFX->SetUsingAbsoluteRotation(true);

	for (int32 i = 0; i < RakisWorm::MaxRingSandfall; ++i)
	{
		UNiagaraComponent* FX = CreateDefaultSubobject<UNiagaraComponent>(*FString::Printf(TEXT("RingSandfallFX%d"), i));
		FX->SetupAttachment(SceneRoot);
		FX->SetAutoActivate(false);
		FX->SetUsingAbsoluteLocation(true);
		FX->SetUsingAbsoluteRotation(true);
		RingSandfallFX.Add(FX);
	}

	ApproachAudio = CreateDefaultSubobject<UAudioComponent>(TEXT("ApproachAudio"));
	ApproachAudio->SetupAttachment(SceneRoot);
	ApproachAudio->SetAutoActivate(false);
	ApproachAudio->SetUsingAbsoluteLocation(true);

	RoarAudio = CreateDefaultSubobject<UAudioComponent>(TEXT("RoarAudio"));
	RoarAudio->SetupAttachment(SceneRoot);
	RoarAudio->SetAutoActivate(false);
	RoarAudio->SetUsingAbsoluteLocation(true);

	static ConstructorHelpers::FObjectFinder<UStaticMesh> CylinderFinder(TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
	if (CylinderFinder.Succeeded())
	{
		FallbackCylinderMesh = CylinderFinder.Object;
	}
	static ConstructorHelpers::FObjectFinder<UStaticMesh> CubeFinder(TEXT("/Engine/BasicShapes/Cube.Cube"));
	if (CubeFinder.Succeeded())
	{
		FallbackCubeMesh = CubeFinder.Object;
	}

	SegmentMeshAsset = TSoftObjectPtr<UStaticMesh>(FSoftObjectPath(TEXT("/Game/Rakis/Worm/SM_Worm_Segment.SM_Worm_Segment")));
	HeadMeshAsset = TSoftObjectPtr<UStaticMesh>(FSoftObjectPath(TEXT("/Game/Rakis/Worm/SM_Worm_Head.SM_Worm_Head")));
	FallbackBodyMaterial = TSoftObjectPtr<UMaterialInterface>(FSoftObjectPath(TEXT("/Game/Rakis/Materials/Master/M_Worm_Chitin.M_Worm_Chitin")));
	SandWaveSystem = TSoftObjectPtr<UNiagaraSystem>(FSoftObjectPath(TEXT("/Game/Rakis/FX/NS_Worm_SandWave.NS_Worm_SandWave")));
	RingSandfallSystem = TSoftObjectPtr<UNiagaraSystem>(FSoftObjectPath(TEXT("/Game/Rakis/FX/NS_Worm_RingSandfall.NS_Worm_RingSandfall")));
	BreachSystem = TSoftObjectPtr<UNiagaraSystem>(FSoftObjectPath(TEXT("/Game/Rakis/FX/NS_Worm_Breach.NS_Worm_Breach")));
	RockHopSystem = TSoftObjectPtr<UNiagaraSystem>(FSoftObjectPath(TEXT("/Game/Rakis/FX/NS_Rock_Hop.NS_Rock_Hop")));
	ApproachSound = TSoftObjectPtr<USoundBase>(FSoftObjectPath(TEXT("/Game/Rakis/Audio/MetaSounds/MS_Worm_Approach.MS_Worm_Approach")));
	RoarSound = TSoftObjectPtr<USoundBase>(FSoftObjectPath(TEXT("/Game/Rakis/Audio/MetaSounds/MS_Worm_Roar.MS_Worm_Roar")));
}

// =============================================================================================
// Чистые функции

ERakisWormState ARakisWorm::ComputeNextState(ERakisWormState Current, const FRakisWormSenseInput& In, const URakisWormTuning& Tuning)
{
	switch (Current)
	{
	case ERakisWormState::Dormant:
		if (!In.bCooldownActive && In.Noise >= Tuning.ListenThreshold)
		{
			return ERakisWormState::Listening;
		}
		return ERakisWormState::Dormant;

	case ERakisWormState::Listening:
		if (In.Noise >= Tuning.ApproachThreshold && !In.bTargetSafe)
		{
			return ERakisWormState::Approach;
		}
		if (In.TimeSinceLoud >= Tuning.ListenTime)
		{
			return ERakisWormState::Dormant;
		}
		return ERakisWormState::Listening;

	case ERakisWormState::Approach:
		if (In.DistanceToTarget <= Tuning.SurfaceTriggerDistance)
		{
			// Игрок на камне — червь проходит мимо, не выходя.
			return In.bTargetSafe ? ERakisWormState::Pass : ERakisWormState::Surface;
		}
		if (In.TimeSinceLoud >= Tuning.ListenTime)
		{
			return ERakisWormState::Pass;
		}
		return ERakisWormState::Approach;

	case ERakisWormState::Surface:
		if (In.bRidden)
		{
			return ERakisWormState::Ridden;
		}
		if (In.TimeInState >= Tuning.SurfaceDuration)
		{
			return ERakisWormState::Pass;
		}
		return ERakisWormState::Surface;

	case ERakisWormState::Ridden:
		return In.bRidden ? ERakisWormState::Ridden : ERakisWormState::Pass;

	case ERakisWormState::Pass:
		return In.TimeInState >= Tuning.PassTime ? ERakisWormState::Dormant : ERakisWormState::Pass;

	default:
		return Current;
	}
}

float ARakisWorm::ComputeThreat01(ERakisWormState InState, float InDistanceToPlayer, float Noise, float TimeInState, const URakisWormTuning& Tuning)
{
	const float Proximity = 1.f - FMath::Clamp(InDistanceToPlayer / FMath::Max(Tuning.ThreatMaxDistance, 1.f), 0.f, 1.f);

	float Threat = 0.f;
	switch (InState)
	{
	case ERakisWormState::Listening:
	{
		const float NoiseAlpha = FMath::Clamp(Noise / FMath::Max(Tuning.ApproachThreshold, KINDA_SMALL_NUMBER), 0.f, 1.f);
		Threat = FMath::Lerp(0.15f, 0.35f, NoiseAlpha) * FMath::Lerp(0.5f, 1.f, Proximity);
		break;
	}
	case ERakisWormState::Approach:
		Threat = FMath::Lerp(0.4f, 1.f, Proximity);
		break;
	case ERakisWormState::Surface:
		Threat = FMath::Lerp(0.55f, 1.f, Proximity);
		break;
	case ERakisWormState::Ridden:
		Threat = FMath::Lerp(0.2f, 0.6f, Proximity);
		break;
	case ERakisWormState::Pass:
		Threat = FMath::Lerp(0.5f, 0.9f, Proximity) * (1.f - FMath::Clamp(TimeInState / FMath::Max(Tuning.PassTime, 0.1f), 0.f, 1.f));
		break;
	case ERakisWormState::Dormant:
	default:
		Threat = 0.f;
		break;
	}
	return FMath::Clamp(Threat, 0.f, 1.f);
}

// =============================================================================================
// Жизненный цикл

void ARakisWorm::OnConstruction(const FTransform& Transform)
{
	Super::OnConstruction(Transform);

	// Превью в редакторе: тело лежит прямо за актором на его высоте — видно масштаб 360 м.
	LoadAssets(false);
	GroundZ = Transform.GetLocation().Z;
	ResetPose(Transform.GetLocation(), Transform.Rotator().Yaw, 0.f, 0.f);
	UpdateHeadAndMouth(0.f);
}

void ARakisWorm::BeginPlay()
{
	Super::BeginPlay();

	const URakisWormTuning* Tuning = URakisWormTuning::Get();
	SetActorTickInterval(1.f / FMath::Clamp(Tuning->MovementHz, 5.f, 120.f));

	LoadAssets(true);
	LoadedBreachSystem = RakisAssets::Load(BreachSystem, TEXT("RakisWorm.BreachSystem"));

	// Точка покоя: актор с тегом Rakis.Worm.Spawn или сам червь.
	HomeLocation = GetActorLocation();
	if (!HomeTag.IsNone())
	{
		TArray<AActor*> Homes;
		UGameplayStatics::GetAllActorsWithTag(this, HomeTag, Homes);
		if (Homes.Num() > 0 && Homes[0])
		{
			HomeLocation = Homes[0]->GetActorLocation();
		}
	}

	GroundZ = TraceGroundZ(HomeLocation, HomeLocation.Z);
	ResetPose(HomeLocation, GetActorRotation().Yaw, Tuning->BurrowDepth, 0.f);

	if (bDrivePlayerFeedback)
	{
		if (const URakisSettings* Settings = URakisSettings::Get())
		{
			WeatherMPC = RakisAssets::Load(Settings->WeatherMPC, TEXT("RakisWorm.WeatherMPC"));
		}
	}

	UWorld* World = GetWorld();
	StateEnterTime = GetNow();
	LastSenseTime = GetNow();
	if (World)
	{
		World->GetTimerManager().SetTimer(SenseTimer, this, &ARakisWorm::SenseUpdate, 1.f / FMath::Clamp(Tuning->SenseHz, 1.f, 60.f), true);
	}
}

void ARakisWorm::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().ClearTimer(SenseTimer);
	}
	if (bDrivePlayerFeedback)
	{
		// Не оставлять игроку «вечную» тряску/вибрацию после выгрузки червя.
		if (UWorld* World = GetWorld())
		{
			if (ARakisPlayerController* PC = Cast<ARakisPlayerController>(World->GetFirstPlayerController()))
			{
				PC->ApplyWormThreat(0.f);
			}
		}
	}
	Super::EndPlay(EndPlayReason);
}

float ARakisWorm::GetNow() const
{
	const UWorld* World = GetWorld();
	return World ? World->GetTimeSeconds() : 0.f;
}

APawn* ARakisWorm::GetPlayerPawn() const
{
	return UGameplayStatics::GetPlayerPawn(this, 0);
}

float ARakisWorm::TraceGroundZ(const FVector& Where, float FallbackZ) const
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return FallbackZ;
	}
	const FVector Start(Where.X, Where.Y, Where.Z + 200000.f);
	const FVector End(Where.X, Where.Y, Where.Z - 200000.f);
	FCollisionQueryParams Params(SCENE_QUERY_STAT(RakisWormGround), false, this);
	FHitResult Hit;
	if (World->LineTraceSingleByChannel(Hit, Start, End, ECC_WorldStatic, Params))
	{
		return Hit.ImpactPoint.Z;
	}
	return FallbackZ;
}

// =============================================================================================
// Ассеты и поза

void ARakisWorm::LoadAssets(bool bForGameplay)
{
	const URakisWormTuning* Tuning = URakisWormTuning::Get();
	UMaterialInterface* FallbackMaterial = nullptr;

	// Кольца тела.
	UStaticMesh* Segment = RakisAssets::Load(SegmentMeshAsset, TEXT("RakisWorm.SegmentMesh"));
	bUsingFallbackSegment = (Segment == nullptr);
	if (bUsingFallbackSegment)
	{
		Segment = FallbackCylinderMesh;
		FallbackMaterial = RakisAssets::Load(FallbackBodyMaterial, TEXT("RakisWorm.FallbackBodyMaterial"), false);
	}
	if (Segment && BodySegments->GetStaticMesh() != Segment)
	{
		BodySegments->SetStaticMesh(Segment);
	}
	if (Segment)
	{
		SegmentMeshSize = Segment->GetBounds().BoxExtent * 2.f;
		SegmentMeshSize = SegmentMeshSize.ComponentMax(FVector(1.f));
	}
	if (bUsingFallbackSegment && FallbackMaterial)
	{
		BodySegments->SetMaterial(0, FallbackMaterial);
	}

	// Голова.
	UStaticMesh* Head = RakisAssets::Load(HeadMeshAsset, TEXT("RakisWorm.HeadMesh"));
	bUsingFallbackHead = (Head == nullptr);
	if (bUsingFallbackHead)
	{
		Head = FallbackCylinderMesh;
	}
	if (Head && HeadMesh->GetStaticMesh() != Head)
	{
		HeadMesh->SetStaticMesh(Head);
	}
	if (Head)
	{
		HeadMeshSize = (Head->GetBounds().BoxExtent * 2.f).ComponentMax(FVector(1.f));
	}

	const float D = Tuning->Diameter;
	if (bUsingFallbackHead || !bHeadMeshAlongX)
	{
		// Цилиндр по Z → ось X опоры головы; длина HeadLength, диаметр чуть больше тела.
		HeadMesh->SetRelativeRotation(RakisWorm::ZToXAxis);
		HeadMesh->SetRelativeScale3D(FVector(D * 1.04f / HeadMeshSize.X, D * 1.04f / HeadMeshSize.Y, Tuning->HeadLength / HeadMeshSize.Z));
		if (FallbackMaterial)
		{
			HeadMesh->SetMaterial(0, FallbackMaterial);
		}
	}
	else
	{
		// Авторская голова: равномерный масштаб по диаметру.
		HeadMesh->SetRelativeRotation(FQuat::Identity);
		HeadMesh->SetRelativeScale3D(FVector(D / FMath::Max(HeadMeshSize.Y, HeadMeshSize.Z)));
	}

	// Динамический материал головы — только для авторского меша (параметр "MouthOpen").
	HeadMID = nullptr;
	if (!bUsingFallbackHead && bForGameplay)
	{
		HeadMID = HeadMesh->CreateAndSetMaterialInstanceDynamic(0);
	}

	// Лепестки: отдельный меш, иначе (если нет авторской головы) — плиты-кубы.
	UStaticMesh* Petal = RakisAssets::Load(PetalMeshAsset, TEXT("RakisWorm.PetalMesh"), false);
	bUsingFallbackPetal = (Petal == nullptr);
	const bool bShowPetals = Petal != nullptr || bUsingFallbackHead;
	if (bUsingFallbackPetal)
	{
		Petal = FallbackCubeMesh;
	}
	if (Petal)
	{
		PetalMeshSize = (Petal->GetBounds().BoxExtent * 2.f).ComponentMax(FVector(1.f));
	}

	const float R = D * 0.5f;
	const float PetalLength = R * 1.15f;
	for (int32 i = 0; i < PetalMeshes.Num(); ++i)
	{
		UStaticMeshComponent* PetalComp = PetalMeshes[i];
		if (!PetalComp)
		{
			continue;
		}
		PetalComp->SetVisibility(bShowPetals);
		if (Petal && PetalComp->GetStaticMesh() != Petal)
		{
			PetalComp->SetStaticMesh(Petal);
		}
		PetalComp->SetRelativeLocation(FVector(PetalLength * 0.5f, 0.f, 0.f));
		if (bUsingFallbackPetal)
		{
			PetalComp->SetRelativeScale3D(FVector(PetalLength / PetalMeshSize.X, R * 1.5f / PetalMeshSize.Y, 260.f / PetalMeshSize.Z));
			if (FallbackMaterial)
			{
				PetalComp->SetMaterial(0, FallbackMaterial);
			}
		}
		else
		{
			PetalComp->SetRelativeScale3D(FVector(PetalLength / PetalMeshSize.X));
		}
	}

	// Niagara и звук — только в игре.
	if (bForGameplay)
	{
		if (UNiagaraSystem* Wave = RakisAssets::Load(SandWaveSystem, TEXT("RakisWorm.SandWave")))
		{
			SandWaveFX->SetAsset(Wave);
		}
		if (UNiagaraSystem* Hop = RakisAssets::Load(RockHopSystem, TEXT("RakisWorm.RockHop")))
		{
			RockHopFX->SetAsset(Hop);
		}
		if (UNiagaraSystem* Fall = RakisAssets::Load(RingSandfallSystem, TEXT("RakisWorm.RingSandfall")))
		{
			for (UNiagaraComponent* FX : RingSandfallFX)
			{
				if (FX)
				{
					FX->SetAsset(Fall);
				}
			}
		}
		if (USoundBase* Approach = RakisAssets::Load(ApproachSound, TEXT("RakisWorm.ApproachSound")))
		{
			ApproachAudio->SetSound(Approach);
		}
		if (USoundBase* Roar = RakisAssets::Load(RoarSound, TEXT("RakisWorm.RoarSound")))
		{
			RoarAudio->SetSound(Roar);
		}
	}
}

void ARakisWorm::ResetPose(const FVector& InHeadLocation, float InYaw, float StartDepthBelowGround, float TailSlope)
{
	const URakisWormTuning* Tuning = URakisWormTuning::Get();
	const float SegmentLength = Tuning->Length / FMath::Max(1, Tuning->SegmentCount);
	const float Spacing = FMath::Max(10.f, SegmentLength * TrailSpacingFactor);

	HeadYaw = InYaw;
	HeadPitch = 0.f;
	HeadLocation = FVector(InHeadLocation.X, InHeadLocation.Y, GroundZ - StartDepthBelowGround);
	HeadRotation = FRotator(0.f, HeadYaw, 0.f);

	const FVector Back = -FRotator(0.f, HeadYaw, 0.f).Vector();
	const int32 Count = FMath::CeilToInt((Tuning->Length + Tuning->HeadLength) / Spacing) + 4;
	Trail.Reset(Count + 8);
	for (int32 k = Count; k >= 1; --k)
	{
		FVector P = HeadLocation + Back * (k * Spacing);
		const float Depth = FMath::Min(Tuning->BurrowDepth + Tuning->Diameter, StartDepthBelowGround + k * Spacing * TailSlope);
		P.Z = GroundZ - Depth;
		Trail.Add(P);
	}

	UpdateBody();
}

// =============================================================================================
// Мозг (SenseHz)

void ARakisWorm::SenseUpdate()
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}
	const URakisWormTuning* Tuning = URakisWormTuning::Get();
	const URakisNoiseTuning* NoiseTuning = URakisNoiseTuning::Get();

	const float Now = GetNow();
	const float Dt = FMath::Max(0.f, Now - LastSenseTime);
	LastSenseTime = Now;

	// Песок под головой (во время скриптованного выхода высота фиксирована на старте).
	if (State != ERakisWormState::Surface)
	{
		GroundZ = TraceGroundZ(HeadLocation, GroundZ);
	}

	APawn* Player = GetPlayerPawn();
	const ARakisCharacter* PlayerCharacter = Cast<ARakisCharacter>(Player);
	DistanceToPlayer = Player ? FVector::Dist(Player->GetActorLocation(), HeadLocation) : 1.e9f;

	// Слух: взвешенная сумма событий у поверхности над головой.
	float Noise = 0.f;
	float BestContribution = 0.f;
	FVector BestLocation = FVector::ZeroVector;
	if (bSensingEnabled)
	{
		if (const URakisNoiseSubsystem* NoiseSubsystem = World->GetSubsystem<URakisNoiseSubsystem>())
		{
			const FVector Ear(HeadLocation.X, HeadLocation.Y, GroundZ);
			TArray<FRakisNoiseEvent> Events;
			NoiseSubsystem->GetRecentEvents(NoiseTuning->EventMaxAge, Events);
			for (const FRakisNoiseEvent& Event : Events)
			{
				const float Weight = (Event.Source == RakisWorm::ThumperSource) ? Tuning->ThumperWeight : 1.f;
				const float Contribution = URakisNoiseSubsystem::ComputeContribution(Event.Loudness * Weight,
					FVector::Dist(Ear, Event.Location), Tuning->HearingRadius, Now - Event.Time,
					NoiseTuning->EventMemoryTau, NoiseTuning->EventMaxAge);
				Noise += Contribution;
				if (Contribution > BestContribution)
				{
					BestContribution = Contribution;
					BestLocation = Event.Location;
				}
			}
			Noise *= NoiseTuning->SampleScale;
		}
	}
	HeardNoise = Noise;

	if (Noise >= Tuning->ListenThreshold)
	{
		LastLoudTime = Now;
		if (BestContribution > 0.f)
		{
			Target = BestLocation;
			bHasTarget = true;
		}
	}

	FRakisWormSenseInput In;
	In.Noise = Noise;
	In.TimeInState = Now - StateEnterTime;
	In.TimeSinceLoud = Now - LastLoudTime;
	In.DistanceToTarget = bHasTarget ? FVector::Dist2D(HeadLocation, Target) : 1.e9f;
	In.bCooldownActive = Now < CooldownEndTime;
	In.bRidden = bRiddenRequested;
	In.bTargetSafe = Tuning->RockIsSafe && PlayerCharacter && PlayerCharacter->IsOnSafeSurface()
		&& bHasTarget && FVector::Dist2D(Target, PlayerCharacter->GetActorLocation()) < 6000.f;

	const ERakisWormState Next = ComputeNextState(State, In, *Tuning);
	if (Next != State)
	{
		SetState(Next);
	}

	UpdateFeedback(Dt);
}

void ARakisWorm::SetState(ERakisWormState NewState)
{
	if (NewState == State)
	{
		return;
	}
	const ERakisWormState OldState = State;
	State = NewState;
	StateEnterTime = GetNow();

	const URakisWormTuning* Tuning = URakisWormTuning::Get();

	switch (NewState)
	{
	case ERakisWormState::Surface:
		SurfaceStartTime = StateEnterTime;
		SurfaceStartHeight = HeadLocation.Z - GroundZ;
		bBreachFired = false;
		SurfaceAimYaw = HeadYaw;
		if (!bForcedSurface && bHasTarget)
		{
			// Цель — не сам игрок, а точка сбоку от него: червь проходит рядом, величественно.
			const FVector ToTarget = (Target - HeadLocation).GetSafeNormal2D();
			const FVector Side = FVector::CrossProduct(FVector::UpVector, ToTarget);
			const FVector Aim = Target + Side * SurfacePassOffset;
			SurfaceAimYaw = (Aim - HeadLocation).Rotation().Yaw;
		}
		break;

	case ERakisWormState::Dormant:
		if (OldState == ERakisWormState::Pass || OldState == ERakisWormState::Ridden)
		{
			CooldownEndTime = StateEnterTime + Tuning->DormantCooldown;
		}
		bHasTarget = false;
		bForcedSurface = false;
		break;

	case ERakisWormState::Pass:
		bForcedSurface = false;
		break;

	default:
		break;
	}

	UE_LOG(LogRakis, Log, TEXT("RakisWorm: %s -> %s (noise %.2f, dist to player %.0f m)"),
		*StaticEnum<ERakisWormState>()->GetNameStringByValue(static_cast<int64>(OldState)),
		*StaticEnum<ERakisWormState>()->GetNameStringByValue(static_cast<int64>(NewState)),
		HeardNoise, DistanceToPlayer / 100.f);

	OnWormStateChanged.Broadcast(OldState, NewState);
}

void ARakisWorm::UpdateFeedback(float DeltaSeconds)
{
	const URakisWormTuning* Tuning = URakisWormTuning::Get();
	const float Raw = ComputeThreat01(State, DistanceToPlayer, HeardNoise, GetNow() - StateEnterTime, *Tuning);
	Threat01 = FMath::FInterpTo(Threat01, Raw, DeltaSeconds, Tuning->ThreatInterpSpeed);
	if (Threat01 < 0.001f && Raw <= 0.f)
	{
		Threat01 = 0.f;
	}

	UWorld* World = GetWorld();
	if (bDrivePlayerFeedback && World)
	{
		if (WeatherMPC)
		{
			if (UMaterialParameterCollectionInstance* MPCInstance = World->GetParameterCollectionInstance(WeatherMPC))
			{
				MPCInstance->SetScalarParameterValue(ThreatMPCParameterName, Threat01);
			}
		}
		if (ARakisPlayerController* PC = Cast<ARakisPlayerController>(World->GetFirstPlayerController()))
		{
			PC->ApplyWormThreat(Threat01);
		}
	}

	// Гул приближения: звучит во всех состояниях, кроме покоя.
	if (ApproachAudio->GetSound())
	{
		const bool bAudible = State != ERakisWormState::Dormant || Threat01 > 0.02f;
		if (bAudible && !ApproachAudio->IsPlaying())
		{
			ApproachAudio->FadeIn(2.f);
		}
		else if (!bAudible && ApproachAudio->IsPlaying())
		{
			ApproachAudio->FadeOut(4.f, 0.f);
		}
		ApproachAudio->SetFloatParameter(RakisWorm::DistanceParam, DistanceToPlayer / 100.f); // метры
		ApproachAudio->SetFloatParameter(RakisWorm::ThreatParam, Threat01);
	}
}

// =============================================================================================
// Внешнее управление

void ARakisWorm::ForceSurface(const FVector& Location, const FRotator& Facing)
{
	const URakisWormTuning* Tuning = URakisWormTuning::Get();
	const float D = Tuning->Diameter;

	GroundZ = TraceGroundZ(Location, Location.Z);

	// Голова должна пересечь песок ровно в Location: считаем, сколько она пройдёт до этого момента.
	const float StartHeight = -0.75f * D;
	const float SH = FMath::Max(Tuning->SurfaceHeight, 1.f);
	const float S = FMath::Clamp(-StartHeight / (SH - StartHeight), 0.f, 1.f);
	const float RiseAlpha = FMath::Asin(S) * 2.f / PI;            // доля фазы подъёма
	const float TAtGround = 0.35f * RiseAlpha;                       // доля всего выхода
	const float LeadDistance = Tuning->SurfaceSpeed * Tuning->SurfaceDuration * TAtGround;

	const float Yaw = Facing.Yaw;
	const FVector Forward = FRotator(0.f, Yaw, 0.f).Vector();
	ResetPose(Location - Forward * LeadDistance, Yaw, -StartHeight, 0.25f);

	bForcedSurface = true;
	bHasTarget = true;
	Target = Location + Forward * Tuning->Length;
	CooldownEndTime = -1.f;

	if (State == ERakisWormState::Surface)
	{
		// Повторный вызов — перезапуск выхода.
		StateEnterTime = GetNow();
		SurfaceStartTime = StateEnterTime;
		SurfaceStartHeight = StartHeight;
		SurfaceAimYaw = Yaw;
		bBreachFired = false;
	}
	else
	{
		SetState(ERakisWormState::Surface);
		SurfaceStartHeight = StartHeight;
		SurfaceAimYaw = Yaw;
	}
	SetBodyVisible(true);
}

void ARakisWorm::SetRidden(bool bRidden)
{
	bRiddenRequested = bRidden;
	if (bRidden && State == ERakisWormState::Surface)
	{
		SetState(ERakisWormState::Ridden);
	}
	else if (!bRidden && State == ERakisWormState::Ridden)
	{
		SetState(ERakisWormState::Pass);
	}
}

// =============================================================================================
// Тело (Tick @ MovementHz)

void ARakisWorm::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	UpdateMovement(DeltaSeconds);
	UpdateBody();
	UpdateHeadAndMouth(DeltaSeconds);
	UpdateEffects();
}

float ARakisWorm::ComputeSurfaceHeight(float T, float StartHeight, const URakisWormTuning& Tuning) const
{
	// Дуга выхода: быстрый подъём (35 %), «зависание» с лёгким опусканием (до 60 %), нырок.
	const float SH = Tuning.SurfaceHeight;
	const float D = Tuning.Diameter;
	if (T < 0.35f)
	{
		const float A = T / 0.35f;
		return FMath::Lerp(StartHeight, SH, FMath::Sin(A * HALF_PI));
	}
	if (T < 0.6f)
	{
		const float A = (T - 0.35f) / 0.25f;
		return FMath::Lerp(SH, SH * 0.9f, A);
	}
	const float A = FMath::Clamp((T - 0.6f) / 0.4f, 0.f, 1.f);
	return FMath::Lerp(SH * 0.9f, -1.25f * D, 1.f - FMath::Cos(A * HALF_PI));
}

void ARakisWorm::UpdateMovement(float DeltaSeconds)
{
	if (DeltaSeconds <= 0.f)
	{
		return;
	}
	const URakisWormTuning* Tuning = URakisWormTuning::Get();

	if (State == ERakisWormState::Surface)
	{
		UpdateSurfaceScript(DeltaSeconds, *Tuning);
		return;
	}

	const float TimeInState = GetNow() - StateEnterTime;
	float Speed = 0.f;
	float TargetHeight = -Tuning->BurrowDepth;   // относительно песка
	float TurnRate = Tuning->CruiseTurnRate;
	bool bSteer = true;
	FVector Desired = HeadLocation + FRotator(0.f, HeadYaw, 0.f).Vector() * 10000.f;

	switch (State)
	{
	case ERakisWormState::Dormant:
	{
		// Медленный круг вокруг точки покоя.
		const float Radius = FMath::Max(Tuning->DormantWanderRadius, 1000.f);
		WanderAngle = FMath::Fmod(WanderAngle + Tuning->DormantWanderSpeed / Radius * DeltaSeconds, 2.f * PI);
		const FVector OnCircle = HomeLocation + FVector(FMath::Cos(WanderAngle), FMath::Sin(WanderAngle), 0.f) * Radius;
		// Целимся немного вперёд по кругу, чтобы двигаться по касательной.
		const float Ahead = WanderAngle + 0.35f;
		Desired = HomeLocation + FVector(FMath::Cos(Ahead), FMath::Sin(Ahead), 0.f) * Radius;
		if (FVector::Dist2D(HeadLocation, OnCircle) > Radius * 0.5f)
		{
			Desired = OnCircle; // далеко ушёл — сначала вернуться к кругу
		}
		Speed = Tuning->DormantWanderSpeed;
		TargetHeight = -Tuning->BurrowDepth;
		TurnRate = Tuning->CruiseTurnRate * 2.f;
		break;
	}
	case ERakisWormState::Listening:
		if (bHasTarget) { Desired = Target; }
		Speed = Tuning->ListenDriftSpeed;
		TargetHeight = -Tuning->ListenDepth;
		TurnRate = Tuning->ApproachTurnRate * 0.5f;
		break;

	case ERakisWormState::Approach:
		if (bHasTarget) { Desired = Target; }
		Speed = Tuning->ApproachSpeed;
		TargetHeight = -Tuning->ApproachDepth;
		TurnRate = Tuning->ApproachTurnRate;
		break;

	case ERakisWormState::Ridden:
		bSteer = false;
		HeadYaw = FRotator::NormalizeAxis(HeadYaw + RiddenYawRate * DeltaSeconds);
		Speed = Tuning->SurfaceSpeed;
		TargetHeight = Tuning->RiddenHeadHeight;
		break;

	case ERakisWormState::Pass:
	{
		bSteer = false;
		const float A = FMath::Clamp(TimeInState / FMath::Max(Tuning->PassTime, 0.1f), 0.f, 1.f);
		Speed = FMath::Lerp(Tuning->SurfaceSpeed, Tuning->ApproachSpeed * 0.35f, A);
		TargetHeight = -Tuning->BurrowDepth;
		break;
	}
	default:
		break;
	}

	if (bSteer)
	{
		const FVector ToDesired = FVector(Desired.X - HeadLocation.X, Desired.Y - HeadLocation.Y, 0.f);
		if (ToDesired.SizeSquared() > FMath::Square(100.f))
		{
			HeadYaw = FMath::FixedTurn(HeadYaw, ToDesired.Rotation().Yaw, TurnRate * DeltaSeconds);
		}
	}

	const FVector Forward = FRotator(0.f, HeadYaw, 0.f).Vector();
	FVector NewLocation = HeadLocation + Forward * Speed * DeltaSeconds;
	NewLocation.Z = FMath::FInterpConstantTo(HeadLocation.Z, GroundZ + TargetHeight, DeltaSeconds, Tuning->VerticalSpeed);
	MoveHeadTo(NewLocation, DeltaSeconds);
}

void ARakisWorm::UpdateSurfaceScript(float DeltaSeconds, const URakisWormTuning& Tuning)
{
	const float T = FMath::Clamp((GetNow() - SurfaceStartTime) / FMath::Max(Tuning.SurfaceDuration, 0.1f), 0.f, 1.f);

	if (!bForcedSurface)
	{
		HeadYaw = FMath::FixedTurn(HeadYaw, SurfaceAimYaw, Tuning.ApproachTurnRate * 0.5f * DeltaSeconds);
	}

	const FVector Forward = FRotator(0.f, HeadYaw, 0.f).Vector();
	FVector NewLocation = HeadLocation + Forward * Tuning.SurfaceSpeed * DeltaSeconds;
	NewLocation.Z = GroundZ + ComputeSurfaceHeight(T, SurfaceStartHeight, Tuning);

	// Прорыв: голова пробивает песок — взрыв песка, рёв.
	if (!bBreachFired && NewLocation.Z > GroundZ - Tuning.Diameter * 0.35f)
	{
		bBreachFired = true;
		const FVector BreachPoint(NewLocation.X, NewLocation.Y, GroundZ);
		if (LoadedBreachSystem)
		{
			if (UNiagaraComponent* FX = UNiagaraFunctionLibrary::SpawnSystemAtLocation(this, LoadedBreachSystem, BreachPoint,
				FRotator(0.f, HeadYaw, 0.f), FVector(1.f), true, true, ENCPoolMethod::None))
			{
				FX->SetVariableFloat(RakisWorm::IntensityParam, 1.f);
			}
		}
		if (RoarAudio->GetSound())
		{
			RoarAudio->SetWorldLocation(BreachPoint + FVector(0.f, 0.f, Tuning.SurfaceHeight * 0.5f));
			RoarAudio->Play();
		}
		OnBreach.Broadcast(BreachPoint);
	}

	MoveHeadTo(NewLocation, DeltaSeconds);
}

void ARakisWorm::MoveHeadTo(const FVector& NewLocation, float DeltaSeconds)
{
	const FVector Delta = NewLocation - HeadLocation;
	const float Horizontal = Delta.Size2D();
	if (Horizontal > KINDA_SMALL_NUMBER || FMath::Abs(Delta.Z) > KINDA_SMALL_NUMBER)
	{
		const float TargetPitch = FMath::RadiansToDegrees(FMath::Atan2(Delta.Z, FMath::Max(Horizontal, 1.f)));
		HeadPitch = FMath::FInterpTo(HeadPitch, FMath::Clamp(TargetPitch, -70.f, 70.f), DeltaSeconds, 2.5f);
	}
	HeadLocation = NewLocation;
	HeadRotation = FRotator(HeadPitch, HeadYaw, 0.f);

	// След головы — тело идёт по нему, как вагоны за локомотивом.
	const URakisWormTuning* Tuning = URakisWormTuning::Get();
	const float SegmentLength = Tuning->Length / FMath::Max(1, Tuning->SegmentCount);
	const float Spacing = FMath::Max(10.f, SegmentLength * TrailSpacingFactor);
	if (Trail.Num() == 0 || FVector::DistSquared(Trail.Last(), HeadLocation) >= FMath::Square(Spacing))
	{
		Trail.Add(HeadLocation);
		const int32 MaxPoints = FMath::CeilToInt((Tuning->Length + Tuning->HeadLength) / Spacing) + 8;
		if (Trail.Num() > MaxPoints)
		{
			Trail.RemoveAt(0, Trail.Num() - MaxPoints);
		}
	}
}

void ARakisWorm::EnsureSegmentInstances(int32 Count)
{
	if (BodySegments->GetInstanceCount() == Count)
	{
		return;
	}
	BodySegments->ClearInstances();
	BodySegments->SetNumCustomDataFloats(1);
	for (int32 i = 0; i < Count; ++i)
	{
		const int32 Index = BodySegments->AddInstance(FTransform::Identity, true);
		BodySegments->SetCustomDataValue(Index, 0, Count > 1 ? static_cast<float>(i) / (Count - 1) : 0.f, false);
	}
}

void ARakisWorm::UpdateBody()
{
	const URakisWormTuning* Tuning = URakisWormTuning::Get();
	const int32 N = FMath::Max(1, Tuning->SegmentCount);
	const float SegmentLength = Tuning->Length / N;
	const float D = Tuning->Diameter;
	const float NeckOffset = Tuning->HeadLength * 0.45f;

	// 1) Полилиния: голова → след от новых к старым.
	TArray<FVector, TInlineAllocator<256>> Poly;
	Poly.Add(HeadLocation);
	for (int32 i = Trail.Num() - 1; i >= 0; --i)
	{
		if (FVector::DistSquared(Trail[i], Poly.Last()) > 1.f)
		{
			Poly.Add(Trail[i]);
		}
	}
	FVector TailDirection = -FRotator(HeadPitch, HeadYaw, 0.f).Vector();
	if (Poly.Num() >= 2)
	{
		TailDirection = (Poly.Last() - Poly[Poly.Num() - 2]).GetSafeNormal();
		if (TailDirection.IsNearlyZero())
		{
			TailDirection = -FRotator(0.f, HeadYaw, 0.f).Vector();
		}
	}

	// Курсорный обход полилинии по возрастающей дистанции (+ экстраполяция за хвост).
	int32 Cursor = 0;
	float CursorStart = 0.f;
	auto SampleAt = [&](float Distance) -> FVector
	{
		while (Cursor < Poly.Num() - 1)
		{
			const float SegLen = FVector::Dist(Poly[Cursor], Poly[Cursor + 1]);
			if (CursorStart + SegLen >= Distance)
			{
				const float Alpha = SegLen > KINDA_SMALL_NUMBER ? (Distance - CursorStart) / SegLen : 0.f;
				return FMath::Lerp(Poly[Cursor], Poly[Cursor + 1], Alpha);
			}
			CursorStart += SegLen;
			++Cursor;
		}
		return Poly.Last() + TailDirection * FMath::Max(0.f, Distance - CursorStart);
	};

	// 2) Точки сплайна + вертикальная синусоида (у головы — ноль, чтобы голова шла чисто).
	const float Time = GetWorld() ? GetWorld()->GetTimeSeconds() : 0.f;
	float WaveScale = 0.35f;
	switch (State)
	{
	case ERakisWormState::Surface:
	case ERakisWormState::Ridden:	WaveScale = 1.f; break;
	case ERakisWormState::Pass:		WaveScale = 0.7f; break;
	case ERakisWormState::Dormant:	WaveScale = 0.15f; break;
	default: break;
	}

	const int32 Stride = FMath::Max(1, SegmentsPerSplinePoint);
	const int32 NumSplinePoints = N / Stride + 2;
	const float SplineStep = Tuning->Length / (NumSplinePoints - 1);

	BodySpline->ClearSplinePoints(false);
	for (int32 j = 0; j < NumSplinePoints; ++j)
	{
		const float Along = j * SplineStep;               // от шеи
		FVector P = SampleAt(NeckOffset + Along);
		const float U = Along / Tuning->Length;
		const float Envelope = FMath::SmoothStep(0.f, 0.12f, U);
		const float Phase = 2.f * PI * (Along / Tuning->UndulationWavelength - Tuning->UndulationFrequency * Time);
		P.Z += Tuning->UndulationAmplitude * WaveScale * Envelope * FMath::Sin(Phase);
		BodySpline->AddSplinePoint(P, ESplineCoordinateSpace::World, false);
	}
	BodySpline->UpdateSpline();

	// 3) Кольца вдоль сплайна.
	EnsureSegmentInstances(N);
	const float SplineLength = BodySpline->GetSplineLength();
	TArray<FTransform> Transforms;
	Transforms.SetNum(N);
	for (int32 i = 0; i < N; ++i)
	{
		const float U = N > 1 ? static_cast<float>(i) / (N - 1) : 0.f;
		const float Distance = FMath::Min((i + 0.5f) * SegmentLength, SplineLength);
		const FVector Location = BodySpline->GetLocationAtDistanceAlongSpline(Distance, ESplineCoordinateSpace::World);
		FVector Direction = BodySpline->GetDirectionAtDistanceAlongSpline(Distance, ESplineCoordinateSpace::World);
		if (Direction.IsNearlyZero())
		{
			Direction = -TailDirection;
		}
		// Сегмент смотрит «вперёд», к голове.
		const FQuat Facing = FRotationMatrix::MakeFromX(-Direction).ToQuat();

		const float Taper = (U <= TailTaperStart)
			? 1.f
			: FMath::Lerp(1.f, TailMinScale, FMath::SmoothStep(TailTaperStart, 1.f, U));
		const float Dia = D * Taper;
		const float Len = SegmentLength * SegmentOverlap;

		if (bUsingFallbackSegment || !bSegmentMeshAlongX)
		{
			Transforms[i] = FTransform(Facing * RakisWorm::ZToXAxis, Location,
				FVector(Dia / SegmentMeshSize.X, Dia / SegmentMeshSize.Y, Len / SegmentMeshSize.Z));
		}
		else
		{
			Transforms[i] = FTransform(Facing, Location,
				FVector(Len / SegmentMeshSize.X, Dia / SegmentMeshSize.Y, Dia / SegmentMeshSize.Z));
		}
	}
	BodySegments->BatchUpdateInstancesTransforms(0, Transforms, true, true, true);
}

void ARakisWorm::UpdateHeadAndMouth(float DeltaSeconds)
{
	const URakisWormTuning* Tuning = URakisWormTuning::Get();

	HeadPivot->SetWorldLocationAndRotation(HeadLocation, HeadRotation);

	// Пасть раскрывается на выходе и чуть приоткрыта под наездниками.
	float TargetMouth = 0.f;
	if (State == ERakisWormState::Surface)
	{
		const float T = (GetNow() - SurfaceStartTime) / FMath::Max(Tuning->SurfaceDuration, 0.1f);
		TargetMouth = (T > 0.12f && T < 0.7f) ? 1.f : 0.f;
	}
	else if (State == ERakisWormState::Ridden)
	{
		TargetMouth = 0.15f;
	}
	MouthOpen01 = DeltaSeconds > 0.f ? FMath::FInterpConstantTo(MouthOpen01, TargetMouth, DeltaSeconds, MouthSpeed) : TargetMouth;

	if (HeadMID)
	{
		HeadMID->SetScalarParameterValue(MouthParameterName, MouthOpen01);
	}

	// Три лепестка: шарнир на кромке головы, поворот «внутрь ↔ наружу».
	const float R = Tuning->Diameter * 0.5f;
	const float Eased = FMath::SmoothStep(0.f, 1.f, MouthOpen01);
	const float Pitch = FMath::Lerp(PetalClosedPitch, PetalOpenPitch, Eased);
	const int32 Count = PetalPivots.Num();
	for (int32 i = 0; i < Count; ++i)
	{
		USceneComponent* Pivot = PetalPivots[i];
		if (!Pivot)
		{
			continue;
		}
		const float RollDeg = 360.f * i / FMath::Max(1, Count);
		const FQuat Roll(FRotator(0.f, 0.f, RollDeg));
		const FVector HingeLocal = Roll.RotateVector(FVector(Tuning->HeadLength * 0.5f, 0.f, R * 0.9f));
		Pivot->SetRelativeLocationAndRotation(HingeLocal, Roll * FQuat(FRotator(Pitch, 0.f, 0.f)));
	}
}

void ARakisWorm::SetBodyVisible(bool bVisible)
{
	if (bBodyVisible == bVisible)
	{
		return;
	}
	bBodyVisible = bVisible;
	BodySegments->SetVisibility(bVisible);
	HeadPivot->SetVisibility(bVisible, true);
	if (bVisible)
	{
		// Лепестки скрыты, если у авторской головы нет отдельного меша лепестка.
		const bool bShowPetals = bUsingFallbackHead || !bUsingFallbackPetal;
		for (UStaticMeshComponent* Petal : PetalMeshes)
		{
			if (Petal)
			{
				Petal->SetVisibility(bShowPetals);
			}
		}
	}
}

void ARakisWorm::ApplyNiagaraActive(UNiagaraComponent* Component, bool bActive, float Intensity)
{
	if (!Component || !Component->GetAsset())
	{
		return;
	}
	if (bActive)
	{
		if (!Component->IsActive())
		{
			Component->Activate(true);
		}
		Component->SetVariableFloat(RakisWorm::IntensityParam, Intensity);
	}
	else if (Component->IsActive())
	{
		Component->Deactivate();
	}
}

void ARakisWorm::UpdateEffects()
{
	if (!GetWorld() || !GetWorld()->IsGameWorld())
	{
		return;
	}
	const URakisWormTuning* Tuning = URakisWormTuning::Get();
	const float D = Tuning->Diameter;
	const float Depth = GroundZ - HeadLocation.Z;      // > 0 — голова под песком
	const FVector Forward2D = FRotator(0.f, HeadYaw, 0.f).Vector();
	const FVector HeadGround(HeadLocation.X, HeadLocation.Y, GroundZ);

	// Глубоко в покое — тело не рисуем.
	SetBodyVisible(!(State == ERakisWormState::Dormant && Depth > D * 1.2f));

	// Волна песка над головой: Listening/Approach/Pass, пока голова неглубоко.
	{
		const bool bActive = State != ERakisWormState::Dormant && State != ERakisWormState::Ridden
			&& Depth > -D * 0.3f && Depth < D * 1.6f;
		const float Intensity = 1.f - FMath::Clamp(Depth / (D * 1.6f), 0.f, 1.f);
		SandWaveFX->SetWorldLocationAndRotation(HeadGround + Forward2D * D * 0.5f, FRotator(0.f, HeadYaw, 0.f));
		ApplyNiagaraActive(SandWaveFX, bActive, Intensity);
	}

	// Подпрыгивающие камни у движущейся головы.
	{
		const bool bActive = State == ERakisWormState::Approach
			|| (State == ERakisWormState::Listening && HeardNoise > Tuning->ListenThreshold)
			|| (State == ERakisWormState::Surface && !bBreachFired);
		RockHopFX->SetWorldLocation(HeadGround);
		ApplyNiagaraActive(RockHopFX, bActive, FMath::Max(Threat01, 0.3f));
	}

	// Песок, ссыпающийся с колец над поверхностью.
	{
		const bool bSurfaced = State == ERakisWormState::Surface || State == ERakisWormState::Ridden || State == ERakisWormState::Pass;
		const float SplineLength = BodySpline->GetSplineLength();
		const int32 Count = FMath::Min(RingSandfallCount, RingSandfallFX.Num());
		for (int32 k = 0; k < RingSandfallFX.Num(); ++k)
		{
			UNiagaraComponent* FX = RingSandfallFX[k];
			if (!FX)
			{
				continue;
			}
			if (k >= Count)
			{
				ApplyNiagaraActive(FX, false, 0.f);
				continue;
			}
			const float Fraction = 0.06f + 0.16f * k;
			const FVector P = BodySpline->GetLocationAtDistanceAlongSpline(FMath::Min(Fraction * Tuning->Length, SplineLength), ESplineCoordinateSpace::World);
			const bool bAbove = P.Z > GroundZ + D * 0.2f;
			FX->SetWorldLocation(P + FVector(0.f, 0.f, D * 0.45f));
			ApplyNiagaraActive(FX, bSurfaced && bAbove, 1.f);
		}
	}

	ApproachAudio->SetWorldLocation(HeadGround);
}
