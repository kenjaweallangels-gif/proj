#include "Noise/RakisNoiseComponent.h"

#include "Engine/World.h"
#include "GameFramework/Actor.h"
#include "Noise/RakisNoiseSubsystem.h"
#include "Noise/RakisNoiseTuning.h"
#include "TimerManager.h"

URakisNoiseComponent::URakisNoiseComponent()
{
	PrimaryComponentTick.bCanEverTick = false;
}

void URakisNoiseComponent::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().ClearTimer(DecayTimer);
	}
	Super::EndPlay(EndPlayReason);
}

float URakisNoiseComponent::ComputeStepLoudness(float BaseLoudness, float SurfaceMultiplier, float Regularity, float RhythmPenalty)
{
	const float Reg = FMath::Clamp(Regularity, 0.f, 1.f);
	return FMath::Max(0.f, BaseLoudness) * FMath::Max(0.f, SurfaceMultiplier) * (1.f + FMath::Max(0.f, RhythmPenalty) * Reg);
}

float URakisNoiseComponent::ComputeDecayed(float Value, float DecayPerSecond, float DeltaSeconds)
{
	return FMath::Max(0.f, Value - FMath::Max(0.f, DecayPerSecond) * FMath::Max(0.f, DeltaSeconds));
}

float URakisNoiseComponent::ComputeFootstepLoudness(ERakisGait Gait, ERakisSurface Surface, float Regularity) const
{
	const URakisNoiseTuning* Tuning = URakisNoiseTuning::Get();
	float Base = Tuning->WalkLoudness;
	switch (Gait)
	{
	case ERakisGait::Run:		Base = Tuning->RunLoudness; break;
	case ERakisGait::SandWalk:	Base = Tuning->SandWalkLoudness; break;
	default: break;
	}
	return ComputeStepLoudness(Base, Tuning->GetSurfaceMultiplier(Surface), Regularity, Tuning->RhythmPenalty);
}

void URakisNoiseComponent::AddNoise(float Loudness, FName Source)
{
	const AActor* Owner = GetOwner();
	AddNoiseAt(Loudness, Source, Owner ? Owner->GetActorLocation() : FVector::ZeroVector);
}

void URakisNoiseComponent::AddNoiseAt(float Loudness, FName Source, const FVector& Location)
{
	if (Loudness <= 0.f)
	{
		return;
	}

	const URakisNoiseTuning* Tuning = URakisNoiseTuning::Get();
	SetNoise(FMath::Min(1.f, Noise01 + Loudness * Tuning->MeterGainPerStep));
	StartDecay();

	if (bReportToWorld)
	{
		if (UWorld* World = GetWorld())
		{
			if (URakisNoiseSubsystem* Subsystem = World->GetSubsystem<URakisNoiseSubsystem>())
			{
				Subsystem->ReportNoise(FRakisNoiseEvent(Location, Loudness, Source));
			}
		}
	}
}

void URakisNoiseComponent::StartDecay()
{
	UWorld* World = GetWorld();
	if (!World || World->GetTimerManager().IsTimerActive(DecayTimer))
	{
		return;
	}
	LastDecayTime = World->GetTimeSeconds();
	World->GetTimerManager().SetTimer(DecayTimer, this, &URakisNoiseComponent::DecayStep, DecayInterval, true);
}

void URakisNoiseComponent::DecayStep()
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}
	const float Now = World->GetTimeSeconds();
	const float Dt = Now - LastDecayTime;
	LastDecayTime = Now;

	SetNoise(ComputeDecayed(Noise01, URakisNoiseTuning::Get()->DecayPerSecond, Dt));
	if (Noise01 <= 0.f)
	{
		World->GetTimerManager().ClearTimer(DecayTimer);
	}
}

void URakisNoiseComponent::SetNoise(float NewValue)
{
	if (!FMath::IsNearlyEqual(NewValue, Noise01, 1.e-4f))
	{
		Noise01 = NewValue;
		OnNoiseChanged.Broadcast(Noise01);
	}
}
