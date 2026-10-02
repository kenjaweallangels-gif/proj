#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "Engine/EngineTypes.h"
#include "Core/RakisTypes.h"
#include "Noise/RakisNoiseComponent.h"
#include "Engine/TimerHandle.h"
#include "RakisCharacter.generated.h"

class UCameraComponent;
class USpringArmComponent;
class UStaticMeshComponent;
class UStaticMesh;
class UNiagaraSystem;
class USoundBase;
class URakisHydrationComponent;
class URakisSandWalkComponent;
class URakisInteractionComponent;
class ARakisThumper;
struct FInputActionValue;
struct FHitResult;

/**
 * Кайр — персонаж игрока. 3-е лицо (SpringArm + камера) и 1-е лицо (камера на сокете "head"
 * или на высоте глаз), бесшовный переход: камера 3-го лица плавно «влетает» в голову и только
 * потом переключается на камеру 1-го лица (и обратно).
 * Шаги: AnimNotify вызывает OnFootstep; если уведомлений нет — таймер по пройденной дистанции.
 * Каждый шаг → поверхность (Physical Material SurfaceType1..6) → шум, ритм, NS_Footstep_Sand, MS_Footstep.
 */
UCLASS()
class RAKIS_API ARakisCharacter : public ACharacter
{
	GENERATED_BODY()

public:
	ARakisCharacter();

	// --- Компоненты (контракт §2.2) ---
	UFUNCTION(BlueprintPure, Category = "Rakis|Player") URakisNoiseComponent* GetNoise() const { return NoiseComponent; }
	UFUNCTION(BlueprintPure, Category = "Rakis|Player") URakisHydrationComponent* GetHydration() const { return HydrationComponent; }
	UFUNCTION(BlueprintPure, Category = "Rakis|Player") URakisSandWalkComponent* GetSandWalk() const { return SandWalkComponent; }
	UFUNCTION(BlueprintPure, Category = "Rakis|Player") URakisInteractionComponent* GetInteraction() const { return InteractionComponent; }

	// --- Камера ---
	/** true — целевой режим 1-е лицо (во время перехода уже true). */
	UFUNCTION(BlueprintPure, Category = "Rakis|Camera")
	bool IsFirstPerson() const { return bFirstPerson; }

	/** Бесшовное переключение FP/TP. */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Camera")
	void SetFirstPerson(bool bEnable);

	UFUNCTION(BlueprintCallable, Category = "Rakis|Camera")
	void ToggleCameraMode() { SetFirstPerson(!bFirstPerson); }

	// --- Поверхность и шаги ---
	UFUNCTION(BlueprintPure, Category = "Rakis|Player")
	ERakisSurface GetCurrentSurface() const { return CurrentSurface; }

	/** Камень/камень сиетча — червь не слышит (RockIsSafe). */
	UFUNCTION(BlueprintPure, Category = "Rakis|Player")
	bool IsOnSafeSurface() const { return CurrentSurface == ERakisSurface::Rock || CurrentSurface == ERakisSurface::SietchStone; }

	UFUNCTION(BlueprintPure, Category = "Rakis|Player")
	ERakisGait GetGait() const { return Gait; }

	/** Шаг. Вызывается из AnimNotify; пока приходят уведомления, таймер-фоллбек молчит. */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Player")
	void OnFootstep(bool bLeftFoot);

	// --- Ввод ---
	/** Блок ввода для кат-сцен: стоп движения, сброс походки, выключение взаимодействия. */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Player")
	void SetInputLocked(bool bLocked);

	UFUNCTION(BlueprintPure, Category = "Rakis|Player")
	bool IsInputLocked() const { return bInputLocked; }

	// --- Тампер ---
	/** Поставить тампер перед собой (только на песке). true — поставлен. */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Thumper")
	bool DeployThumper();

	UFUNCTION(BlueprintCallable, Category = "Rakis|Thumper")
	void AddThumperCharges(int32 Delta) { ThumperCharges = FMath::Max(0, ThumperCharges + Delta); }

	UFUNCTION(BlueprintPure, Category = "Rakis|Thumper")
	int32 GetThumperCharges() const { return ThumperCharges; }

	/** SurfaceType1..6 из DefaultEngine.ini → ERakisSurface (Default → Unknown). */
	static ERakisSurface SurfaceFromPhysicalSurface(EPhysicalSurface Surface);

	virtual void Tick(float DeltaSeconds) override;

protected:
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;
	virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;

	// --- Компоненты ---
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Rakis|Camera")
	TObjectPtr<USpringArmComponent> CameraBoom;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Rakis|Camera")
	TObjectPtr<UCameraComponent> ThirdPersonCamera;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Rakis|Camera")
	TObjectPtr<UCameraComponent> FirstPersonCamera;

	/** Видимое «тело» блокаута, если у Mesh нет скелетного меша (рендер без арта). */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Rakis|Player")
	TObjectPtr<UStaticMeshComponent> BlockoutBody;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Rakis|Player")
	TObjectPtr<URakisNoiseComponent> NoiseComponent;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Rakis|Player")
	TObjectPtr<URakisHydrationComponent> HydrationComponent;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Rakis|Player")
	TObjectPtr<URakisSandWalkComponent> SandWalkComponent;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Rakis|Player")
	TObjectPtr<URakisInteractionComponent> InteractionComponent;

	// --- Скорости (см/с) ---
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Movement", meta = (ClampMin = "0"))
	float WalkSpeed = 220.f;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Movement", meta = (ClampMin = "0"))
	float RunSpeed = 520.f;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Movement", meta = (ClampMin = "0"))
	float SandWalkSpeed = 160.f;

	/** Замедление во время «сбивки» ритма (доля SandWalkSpeed) и её длительность, с. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Movement", meta = (ClampMin = "0", ClampMax = "1"))
	float StutterSpeedFactor = 0.45f;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Movement", meta = (ClampMin = "0"))
	float StutterSlowTime = 0.3f;

	// --- Камера ---
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Camera")
	bool bStartInFirstPerson = false;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Camera", meta = (ClampMin = "0"))
	float ThirdPersonArmLength = 320.f;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Camera")
	FVector ThirdPersonSocketOffset = FVector(0.f, 55.f, 55.f);

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Camera", meta = (ClampMin = "30", ClampMax = "130"))
	float ThirdPersonFOV = 75.f;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Camera", meta = (ClampMin = "30", ClampMax = "130"))
	float FirstPersonFOV = 88.f;

	/** Длительность перехода FP↔TP, с. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Camera", meta = (ClampMin = "0.05"))
	float CameraBlendTime = 0.45f;

	/** Сокет/кость головы для камеры 1-го лица и скрытия головы. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Camera")
	FName HeadSocketName = TEXT("head");

	/** Смещение FP-камеры относительно сокета головы (в пространстве сокета). */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Camera")
	FVector FirstPersonSocketOffset = FVector(0.f, 0.f, 0.f);

	/** Фоллбек FP-камеры без сокета: относительно капсулы. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Camera")
	FVector FirstPersonFallbackOffset = FVector(12.f, 0.f, 68.f);

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Camera", meta = (ClampMin = "-89", ClampMax = "0"))
	float MinViewPitch = -75.f;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Camera", meta = (ClampMin = "0", ClampMax = "89"))
	float MaxViewPitch = 70.f;

	// --- Шаги ---
	/** Длина шага при скорости SandWalkSpeed и RunSpeed (линейно между), см. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Footsteps", meta = (ClampMin = "10"))
	float StepLengthSlow = 62.f;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Footsteps", meta = (ClampMin = "10"))
	float StepLengthFast = 120.f;

	/** Если AnimNotify не приходил дольше — работают шаги по таймеру, с. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Footsteps", meta = (ClampMin = "0.1"))
	float AnimFootstepTimeout = 0.8f;

	/** Частота таймера шагов-фоллбека, Гц. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Footsteps", meta = (ClampMin = "5", ClampMax = "120"))
	float FootstepTimerHz = 30.f;

	/** Пауза после «сбивки»: доля длины шага, случайно в диапазоне. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Footsteps", meta = (ClampMin = "0", ClampMax = "2"))
	float StutterPauseMin = 0.25f;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Footsteps", meta = (ClampMin = "0", ClampMax = "2"))
	float StutterPauseMax = 0.7f;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Footsteps")
	FName LeftFootSocket = TEXT("foot_l");

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Footsteps")
	FName RightFootSocket = TEXT("foot_r");

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Footsteps")
	TSoftObjectPtr<UNiagaraSystem> FootstepSandFX;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Footsteps")
	TSoftObjectPtr<USoundBase> FootstepSound;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Footsteps", meta = (ClampMin = "0"))
	float FootstepVolume = 1.f;

	// --- Поверхность ---
	/** Частота проверки поверхности вне шагов, Гц. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Surface", meta = (ClampMin = "1", ClampMax = "30"))
	float SurfaceCheckHz = 5.f;

	/** Поверхность, если у материала нет Physical Material (блокаут — песок). */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Surface")
	ERakisSurface DefaultSurface = ERakisSurface::Sand;

	/** Тег-переопределение на акторе/компоненте: "Rakis.Surface.Rock" и т.п. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Surface")
	FString SurfaceTagPrefix = TEXT("Rakis.Surface.");

	// --- Тампер ---
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Thumper")
	TSubclassOf<ARakisThumper> ThumperClass;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Thumper", meta = (ClampMin = "0"))
	int32 ThumperCharges = 2;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Thumper", meta = (ClampMin = "0"))
	float ThumperPlaceDistance = 130.f;

private:
	// Ввод
	void Input_Move(const FInputActionValue& Value);
	void Input_Look(const FInputActionValue& Value);
	void Input_SprintStarted();
	void Input_SprintCompleted();
	void Input_SandWalkStarted();
	void Input_SandWalkCompleted();
	void Input_Stutter();
	void Input_Interact();
	void Input_ToggleCamera();
	void Input_Thumper();

	void UpdateGait();
	void EndStutterSlow();
	void HandleFootstep(bool bLeftFoot);
	void UpdateFootstepFallback();
	void UpdateSurface();
	ERakisSurface SurfaceFromHit(const FHitResult& Hit) const;
	float GetStepLength(float Speed) const;
	FVector GetFootLocation(bool bLeftFoot) const;
	void SetupFirstPersonCameraAttachment();
	void ApplyRotationMode(bool bFirstPersonMode);
	void FinishCameraBlend();
	void SetHeadHidden(bool bHidden);

	UPROPERTY(Transient)
	TObjectPtr<UNiagaraSystem> LoadedFootstepFX;

	UPROPERTY(Transient)
	TObjectPtr<USoundBase> LoadedFootstepSound;

	ERakisSurface CurrentSurface = ERakisSurface::Unknown;
	ERakisGait Gait = ERakisGait::Walk;

	bool bFirstPerson = false;
	bool bBlending = false;
	float CameraAlpha = 0.f;     // 0 = TP, 1 = FP

	bool bInputLocked = false;
	bool bSprintHeld = false;
	bool bStutterSlow = false;
	bool bNextLeftFoot = true;
	bool bHeadHidden = false;

	float LastAnimFootstepTime = -100.f;
	float LastFallbackTime = 0.f;
	float StepDistanceAccum = 0.f;

	FTimerHandle FootstepTimer;
	FTimerHandle SurfaceTimer;
	FTimerHandle StutterTimer;
};
