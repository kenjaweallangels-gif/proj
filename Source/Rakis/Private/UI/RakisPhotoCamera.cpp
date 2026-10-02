#include "UI/RakisPhotoCamera.h"

#include "Camera/CameraComponent.h"

ARakisPhotoCamera::ARakisPhotoCamera()
{
	PrimaryActorTick.bCanEverTick = false;
	SetCanBeDamaged(false);

	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("PhotoCamera"));
	SetRootComponent(Camera);
	Camera->bConstrainAspectRatio = false;
	Camera->bUsePawnControlRotation = false;
	Camera->PostProcessBlendWeight = 1.f;
	Camera->SetFieldOfView(60.f);
}

void ARakisPhotoCamera::ApplySettings(float FovDegrees, float FocalDistanceCm, float FStop, float ExposureDeltaEV)
{
	if (!Camera)
	{
		return;
	}
	Camera->SetFieldOfView(FMath::Clamp(FovDegrees, 5.f, 170.f));

	FPostProcessSettings& PP = Camera->PostProcessSettings;

	// Кинематографический DOF: фокусное расстояние 0 = DOF выключен.
	PP.bOverride_DepthOfFieldFocalDistance = true;
	PP.DepthOfFieldFocalDistance = FMath::Max(0.f, FocalDistanceCm);
	PP.bOverride_DepthOfFieldFstop = FocalDistanceCm > 0.f;
	PP.DepthOfFieldFstop = FMath::Clamp(FStop, 1.2f, 22.f);

	// Экспозиция — только если игрок её менял, иначе сохраняем погодную.
	PP.bOverride_AutoExposureBias = !FMath::IsNearlyZero(ExposureDeltaEV, 0.01f);
	PP.AutoExposureBias = BaseExposureBias + ExposureDeltaEV;
}
