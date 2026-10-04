#pragma once

#include "CoreMinimal.h"
#include "GameFramework/PlayerController.h"
#include "RakisPlayerController.generated.h"

class UInputAction;
class UInputMappingContext;
class UCameraShakeBase;

DECLARE_DYNAMIC_MULTICAST_DELEGATE(FOnPauseRequested);
DECLARE_DYNAMIC_MULTICAST_DELEGATE(FOnPhotoModeRequested);

/** Набор действий Enhanced Input, созданных в рантайме (ассеты не нужны). */
USTRUCT(BlueprintType)
struct RAKIS_API FRakisInputActions
{
	GENERATED_BODY()

	/** Axis2D: WASD / левый стик. X — вправо, Y — вперёд. */
	UPROPERTY(Transient, BlueprintReadOnly, Category = "Rakis|Input") TObjectPtr<UInputAction> Move;
	/** Axis2D: мышь / правый стик, уже в градусах (X — рыскание, Y — тангаж вверх). */
	UPROPERTY(Transient, BlueprintReadOnly, Category = "Rakis|Input") TObjectPtr<UInputAction> Look;
	/** Shift / L3 (удержание). */
	UPROPERTY(Transient, BlueprintReadOnly, Category = "Rakis|Input") TObjectPtr<UInputAction> Sprint;
	/** Alt / LB (удержание). */
	UPROPERTY(Transient, BlueprintReadOnly, Category = "Rakis|Input") TObjectPtr<UInputAction> SandWalk;
	/** Space / A — сбить ритм. */
	UPROPERTY(Transient, BlueprintReadOnly, Category = "Rakis|Input") TObjectPtr<UInputAction> Stutter;
	/** E / X. */
	UPROPERTY(Transient, BlueprintReadOnly, Category = "Rakis|Input") TObjectPtr<UInputAction> Interact;
	/** V / RS (клик правого стика). */
	UPROPERTY(Transient, BlueprintReadOnly, Category = "Rakis|Input") TObjectPtr<UInputAction> ToggleCamera;
	/** T / Y — поставить тампер. */
	UPROPERTY(Transient, BlueprintReadOnly, Category = "Rakis|Input") TObjectPtr<UInputAction> Thumper;
	/** Esc / Start (работает на паузе). */
	UPROPERTY(Transient, BlueprintReadOnly, Category = "Rakis|Input") TObjectPtr<UInputAction> Pause;
	/** P / View(Back) (работает на паузе). */
	UPROPERTY(Transient, BlueprintReadOnly, Category = "Rakis|Input") TObjectPtr<UInputAction> PhotoMode;
};

/**
 * Контроллер игрока «Rakis».
 * - Строит UInputAction и UInputMappingContext в рантайме через NewObject (клавиатура/мышь + геймпад).
 * - Pause/PhotoMode — только делегаты; саму паузу и фоторежим делает UI (ARakisHUD).
 * - Обратная связь угрозы червя: тряска камеры (URakisWormCameraShake) и вибрация геймпада.
 */
UCLASS()
class RAKIS_API ARakisPlayerController : public APlayerController
{
	GENERATED_BODY()

public:
	ARakisPlayerController();

	/** Действия ввода (создаются при первом обращении). */
	const FRakisInputActions& GetInputActions();

	/** Контекст ввода (создаётся при первом обращении). */
	UInputMappingContext* GetMappingContext();

	/** Вибрация геймпада от червя, 0..1 (0 — выключить). */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Feedback")
	void PlayWormRumble(float Intensity01);

	/** Единая точка обратной связи угрозы червя: тряска камеры + вибрация. Вызывает ARakisWorm. */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Feedback")
	void ApplyWormThreat(float Threat01);

	UPROPERTY(BlueprintAssignable, Category = "Rakis|Input")
	FOnPauseRequested OnPauseRequested;

	UPROPERTY(BlueprintAssignable, Category = "Rakis|Input")
	FOnPhotoModeRequested OnPhotoModeRequested;

protected:
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;
	virtual void SetupInputComponent() override;

	/** Градусов поворота на единицу движения мыши (после чувствительности осей движка). */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Input", meta = (ClampMin = "0.01"))
	float MouseLookScale = 2.5f;

	/** Скорость обзора правым стиком, град/с. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Input", meta = (ClampMin = "1"))
	float GamepadLookRate = 150.f;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Input", meta = (ClampMin = "0", ClampMax = "0.9"))
	float GamepadDeadZone = 0.2f;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Input")
	bool bInvertLookY = false;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Input")
	int32 MappingPriority = 0;

	/** Класс тряски от червя. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Feedback")
	TSubclassOf<UCameraShakeBase> WormShakeClass;

	/** ShakeScale при угрозе 1. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Feedback", meta = (ClampMin = "0"))
	float WormShakeMaxScale = 1.6f;

	/** Ниже этой угрозы тряски нет. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Feedback", meta = (ClampMin = "0", ClampMax = "1"))
	float WormShakeThreshold = 0.2f;

	/** Ниже этой угрозы вибрации нет. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Feedback", meta = (ClampMin = "0", ClampMax = "1"))
	float WormRumbleThreshold = 0.3f;

	/** Максимальная сила вибрации. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Feedback", meta = (ClampMin = "0", ClampMax = "1"))
	float WormRumbleMax = 0.85f;

private:
	void BuildInputObjects();
	void AddMappingContextToPlayer();
	void HandlePause();
	void HandlePhotoMode();

	UPROPERTY(Transient)
	FRakisInputActions Actions;

	UPROPERTY(Transient)
	TObjectPtr<UInputMappingContext> MappingContext;

	UPROPERTY(Transient)
	TObjectPtr<UCameraShakeBase> WormShakeInstance;

	/** Хэндл динамической вибрации (тип движка, в 5.x — целочисленный typedef). */
	FDynamicForceFeedbackHandle RumbleHandle = 0;
	bool bInputBuilt = false;
};
