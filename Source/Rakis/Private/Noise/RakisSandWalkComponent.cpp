#include "Noise/RakisSandWalkComponent.h"

#include "Engine/World.h"
#include "Noise/RakisNoiseTuning.h"

URakisSandWalkComponent::URakisSandWalkComponent()
{
	PrimaryComponentTick.bCanEverTick = false;
}

float URakisSandWalkComponent::GetNow() const
{
	const UWorld* World = GetWorld();
	return World ? World->GetTimeSeconds() : 0.f;
}

void URakisSandWalkComponent::SetSandWalking(bool bEnable)
{
	if (bSandWalking != bEnable)
	{
		bSandWalking = bEnable;
		OnSandWalkToggled.Broadcast(bSandWalking);
	}
}

TArray<float> URakisSandWalkComponent::GetRecentIntervals() const
{
	const int32 Count = FMath::Min(HUDIntervalCount, Intervals.Num());
	TArray<float> Result;
	Result.Reserve(Count);
	for (int32 i = Intervals.Num() - Count; i < Intervals.Num(); ++i)
	{
		Result.Add(Intervals[i]);
	}
	return Result;
}

float URakisSandWalkComponent::ComputeRegularity(const TArray<float>& InIntervals, float CVReference)
{
	const int32 N = InIntervals.Num();
	if (N < 2)
	{
		return 0.f;
	}

	double Sum = 0.0;
	for (const float X : InIntervals)
	{
		Sum += X;
	}
	const double Mean = Sum / N;
	if (Mean <= UE_KINDA_SMALL_NUMBER)
	{
		return 0.f;
	}

	double Var = 0.0;
	for (const float X : InIntervals)
	{
		Var += FMath::Square(X - Mean);
	}
	Var /= N;

	const double CV = FMath::Sqrt(Var) / Mean;
	const double Normalized = CV / FMath::Max(static_cast<double>(CVReference), 1.e-3);
	return static_cast<float>(FMath::Clamp(1.0 - Normalized, 0.0, 1.0));
}

float URakisSandWalkComponent::RegisterStep()
{
	const URakisNoiseTuning* Tuning = URakisNoiseTuning::Get();
	const float Now = GetNow();

	if (LastStepTime >= 0.f)
	{
		const float Interval = Now - LastStepTime;
		if (Interval > Tuning->RhythmResetGap)
		{
			// Долгая остановка — ритм начинается заново.
			Intervals.Reset();
		}
		else if (Interval > UE_KINDA_SMALL_NUMBER)
		{
			Intervals.Add(Interval);
			const int32 Window = FMath::Max(2, Tuning->RegularityWindow);
			if (Intervals.Num() > Window)
			{
				Intervals.RemoveAt(0, Intervals.Num() - Window);
			}
		}
	}
	LastStepTime = Now;

	Regularity = ComputeRegularity(Intervals, Tuning->RhythmCVReference);
	OnSandStep.Broadcast(Regularity);
	return Regularity;
}

bool URakisSandWalkComponent::TryStutter()
{
	const float Now = GetNow();
	if (!bSandWalking || Now - LastStutterTime < StutterCooldown)
	{
		return false;
	}
	LastStutterTime = Now;
	OnStutter.Broadcast();
	return true;
}

void URakisSandWalkComponent::ResetRhythm()
{
	Intervals.Reset();
	LastStepTime = -1.f;
	Regularity = 0.f;
}
