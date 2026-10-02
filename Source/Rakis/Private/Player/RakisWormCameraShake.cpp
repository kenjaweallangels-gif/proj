#include "Player/RakisWormCameraShake.h"

void URakisPerlinShakePattern::GetShakePatternInfoImpl(FCameraShakeInfo& OutInfo) const
{
	// Бесконечная тряска; вход/выход считаем сами (Weight), чтобы не зависеть от логики базового класса.
	OutInfo.Duration = FCameraShakeDuration::Infinite();
	OutInfo.BlendIn = 0.f;
	OutInfo.BlendOut = 0.f;
}

void URakisPerlinShakePattern::StartShakePatternImpl(const FCameraShakePatternStartParams& Params)
{
	Time = 0.f;
	Weight = 0.f;
	bStopping = false;
	bStopped = false;
	Seed = FMath::FRandRange(0.f, 1000.f);
}

void URakisPerlinShakePattern::UpdateShakePatternImpl(const FCameraShakePatternUpdateParams& Params, FCameraShakePatternUpdateResult& OutResult)
{
	const float Dt = Params.DeltaTime;
	Time += Dt;

	if (bStopping)
	{
		Weight = FMath::Max(0.f, Weight - Dt / BlendOutTime);
		if (Weight <= 0.f)
		{
			bStopped = true;
		}
	}
	else
	{
		Weight = FMath::Min(1.f, Weight + Dt / BlendInTime);
	}

	auto Noise = [this](float Freq, float Offset)
	{
		return FMath::PerlinNoise1D(Seed + Offset + Time * Freq);
	};

	// Масштаб экземпляра (ShakeScale × DynamicScale) движок применяет к результату сам.
	OutResult.Location = Weight * FVector(
		LocationAmplitude.X * Noise(LocationFrequency, 11.f),
		LocationAmplitude.Y * Noise(LocationFrequency, 37.f),
		LocationAmplitude.Z * Noise(LocationFrequency, 71.f));
	OutResult.Rotation = FRotator(
		Weight * RotationAmplitude.X * Noise(RotationFrequency, 101.f),
		Weight * RotationAmplitude.Y * Noise(RotationFrequency, 131.f),
		Weight * RotationAmplitude.Z * Noise(RotationFrequency, 173.f));
}

bool URakisPerlinShakePattern::IsFinishedImpl() const
{
	return bStopped;
}

void URakisPerlinShakePattern::StopShakePatternImpl(const FCameraShakePatternStopParams& Params)
{
	if (Params.bImmediately)
	{
		bStopped = true;
	}
	else
	{
		bStopping = true;
	}
}

URakisWormCameraShake::URakisWormCameraShake(const FObjectInitializer& ObjectInitializer)
	: Super(ObjectInitializer)
{
	bSingleInstance = true;
	URakisPerlinShakePattern* Pattern = CreateDefaultSubobject<URakisPerlinShakePattern>(TEXT("RootShakePattern"));
	SetRootShakePattern(Pattern);
}
