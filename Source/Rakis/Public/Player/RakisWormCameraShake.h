#pragma once

#include "CoreMinimal.h"
#include "Camera/CameraShakeBase.h"
#include "RakisWormCameraShake.generated.h"

/**
 * Бесконечный шум Перлина для тряски камеры от червя (низкочастотный гул земли).
 * Свой паттерн вместо UPerlinNoiseCameraShakePattern: тот живёт в плагине EngineCameras,
 * которого нет в Rakis.Build.cs. Амплитуда масштабируется ShakeScale экземпляра (≈ угроза червя).
 */
UCLASS()
class RAKIS_API URakisPerlinShakePattern : public UCameraShakePattern
{
	GENERATED_BODY()

public:
	/** Амплитуда смещения, см (X — вперёд, Y — вбок, Z — вверх). */
	UPROPERTY(EditAnywhere, Category = "Rakis|Camera")
	FVector LocationAmplitude = FVector(2.f, 3.f, 6.f);

	/** Частота смещения, Гц. */
	UPROPERTY(EditAnywhere, Category = "Rakis|Camera")
	float LocationFrequency = 7.f;

	/** Амплитуда вращения, град (Pitch, Yaw, Roll). */
	UPROPERTY(EditAnywhere, Category = "Rakis|Camera")
	FVector RotationAmplitude = FVector(0.9f, 0.5f, 1.2f);

	/** Частота вращения, Гц. */
	UPROPERTY(EditAnywhere, Category = "Rakis|Camera")
	float RotationFrequency = 4.f;

	/** Плавный вход/выход, с (собственный, т.к. длительность бесконечна). */
	UPROPERTY(EditAnywhere, Category = "Rakis|Camera", meta = (ClampMin = "0.01"))
	float BlendInTime = 0.5f;

	UPROPERTY(EditAnywhere, Category = "Rakis|Camera", meta = (ClampMin = "0.01"))
	float BlendOutTime = 0.8f;

protected:
	virtual void GetShakePatternInfoImpl(FCameraShakeInfo& OutInfo) const override;
	virtual void StartShakePatternImpl(const FCameraShakePatternStartParams& Params) override;
	virtual void UpdateShakePatternImpl(const FCameraShakePatternUpdateParams& Params, FCameraShakePatternUpdateResult& OutResult) override;
	virtual bool IsFinishedImpl() const override;
	virtual void StopShakePatternImpl(const FCameraShakePatternStopParams& Params) override;

private:
	float Time = 0.f;
	float Seed = 0.f;
	float Weight = 0.f;
	bool bStopping = false;
	bool bStopped = false;
};

/** Тряска камеры от угрозы червя. Запускается ARakisPlayerController, масштаб = f(угроза). */
UCLASS()
class RAKIS_API URakisWormCameraShake : public UCameraShakeBase
{
	GENERATED_BODY()

public:
	URakisWormCameraShake(const FObjectInitializer& ObjectInitializer);
};
