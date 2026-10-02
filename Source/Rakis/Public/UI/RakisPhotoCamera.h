#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "RakisPhotoCamera.generated.h"

class UCameraComponent;

/**
 * Временная камера фоторежима. Создаётся ARakisHUD::EnterPhotoMode, уничтожается при выходе.
 * Пост-эффект (DOF, экспозиция) — override в UCameraComponent::PostProcessSettings с весом 1.
 * Трансформ задаёт SRakisPhotoMode из Slate-тика (работает при замедлении времени).
 */
UCLASS(NotPlaceable, Transient)
class RAKIS_API ARakisPhotoCamera : public AActor
{
	GENERATED_BODY()

public:
	ARakisPhotoCamera();

	/**
	 * FocalDistanceCm <= 0 — DOF выключен. ExposureDeltaEV — относительно BaseExposureBias
	 * (экспозиция глобального пост-объёма в момент входа в фоторежим).
	 */
	void ApplySettings(float FovDegrees, float FocalDistanceCm, float FStop, float ExposureDeltaEV);

	void SetBaseExposureBias(float InBias) { BaseExposureBias = InBias; }

	UCameraComponent* GetCamera() const { return Camera; }

private:
	UPROPERTY(VisibleAnywhere, Category = "Rakis|PhotoMode")
	TObjectPtr<UCameraComponent> Camera;

	float BaseExposureBias = 0.f;
};
