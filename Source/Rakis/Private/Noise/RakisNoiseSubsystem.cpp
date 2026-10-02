#include "Noise/RakisNoiseSubsystem.h"

#include "Engine/World.h"
#include "Noise/RakisNoiseTuning.h"

void URakisNoiseSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);

	const URakisNoiseTuning* Tuning = URakisNoiseTuning::Get();
	Buffer.SetNum(FMath::Max(16, Tuning->EventBufferSize));
	NextIndex = 0;
	NumEvents = 0;
}

bool URakisNoiseSubsystem::DoesSupportWorldType(const EWorldType::Type WorldType) const
{
	// Шум нужен только в игровых мирах (игра и PIE).
	return WorldType == EWorldType::Game || WorldType == EWorldType::PIE;
}

float URakisNoiseSubsystem::GetNow() const
{
	const UWorld* World = GetWorld();
	return World ? World->GetTimeSeconds() : 0.f;
}

void URakisNoiseSubsystem::ReportNoise(const FRakisNoiseEvent& Event)
{
	if (Event.Loudness <= 0.f || Buffer.Num() == 0)
	{
		return;
	}

	FRakisNoiseEvent Stored = Event;
	if (Stored.Time < 0.f)
	{
		Stored.Time = GetNow();
	}

	Buffer[NextIndex] = Stored;
	NextIndex = (NextIndex + 1) % Buffer.Num();
	NumEvents = FMath::Min(NumEvents + 1, Buffer.Num());

	OnNoiseReported.Broadcast(Stored);
}

void URakisNoiseSubsystem::ReportNoiseAt(FVector Location, float Loudness, FName Source)
{
	ReportNoise(FRakisNoiseEvent(Location, Loudness, Source));
}

float URakisNoiseSubsystem::ComputeContribution(float Loudness, float Distance, float Radius, float Age, float Tau, float MaxAge)
{
	if (Loudness <= 0.f || Radius <= 0.f || Distance >= Radius)
	{
		return 0.f;
	}
	Age = FMath::Max(0.f, Age);
	if (Age > MaxAge)
	{
		return 0.f;
	}
	const float DistanceFactor = 1.f - FMath::Max(0.f, Distance) / Radius;
	const float TimeFactor = FMath::Exp(-Age / FMath::Max(Tau, KINDA_SMALL_NUMBER));
	return Loudness * DistanceFactor * TimeFactor;
}

float URakisNoiseSubsystem::SampleNoise(const FVector& Where, float Radius) const
{
	const URakisNoiseTuning* Tuning = URakisNoiseTuning::Get();
	const float Now = GetNow();

	float Sum = 0.f;
	ForEachEvent([&](const FRakisNoiseEvent& Event)
	{
		Sum += ComputeContribution(Event.Loudness, FVector::Dist(Where, Event.Location), Radius,
			Now - Event.Time, Tuning->EventMemoryTau, Tuning->EventMaxAge);
	});
	return Sum * Tuning->SampleScale;
}

bool URakisNoiseSubsystem::GetLoudestRecent(FVector& OutLocation, float MaxAge) const
{
	const URakisNoiseTuning* Tuning = URakisNoiseTuning::Get();
	const float Now = GetNow();

	float Best = 0.f;
	bool bFound = false;
	ForEachEvent([&](const FRakisNoiseEvent& Event)
	{
		const float Age = Now - Event.Time;
		if (Age > MaxAge)
		{
			return;
		}
		const float Score = Event.Loudness * FMath::Exp(-FMath::Max(0.f, Age) / FMath::Max(Tuning->EventMemoryTau, KINDA_SMALL_NUMBER));
		if (Score > Best)
		{
			Best = Score;
			OutLocation = Event.Location;
			bFound = true;
		}
	});
	return bFound;
}

void URakisNoiseSubsystem::GetRecentEvents(float MaxAge, TArray<FRakisNoiseEvent>& OutEvents) const
{
	OutEvents.Reset();
	const float Now = GetNow();
	ForEachEvent([&](const FRakisNoiseEvent& Event)
	{
		if (Now - Event.Time <= MaxAge)
		{
			OutEvents.Add(Event);
		}
	});
}
