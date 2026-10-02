#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Core/RakisTypes.h"
#include "RakisWorm.generated.h"

class USceneComponent;
class USplineComponent;
class UInstancedStaticMeshComponent;
class UStaticMeshComponent;
class UStaticMesh;
class UMaterialInterface;
class UMaterialInstanceDynamic;
class UMaterialParameterCollection;
class UNiagaraComponent;
class UNiagaraSystem;
class UAudioComponent;
class USoundBase;
class URakisWormTuning;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnWormStateChanged, ERakisWormState, OldState, ERakisWormState, NewState);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnWormBreach, FVector, Location);

/** Входные данные автомата состояний червя (чистая функция ARakisWorm::ComputeNextState). */
USTRUCT(BlueprintType)
struct RAKIS_API FRakisWormSenseInput
{
	GENERATED_BODY()

	/** Взвешенный шум у головы (тампер × ThumperWeight). */
	UPROPERTY(BlueprintReadWrite, Category = "Rakis|Worm") float Noise = 0.f;
	/** Сколько секунд червь в текущем состоянии. */
	UPROPERTY(BlueprintReadWrite, Category = "Rakis|Worm") float TimeInState = 0.f;
	/** Сколько секунд шум не превышал ListenThreshold. */
	UPROPERTY(BlueprintReadWrite, Category = "Rakis|Worm") float TimeSinceLoud = 0.f;
	/** Горизонтальная дистанция головы до цели, см. */
	UPROPERTY(BlueprintReadWrite, Category = "Rakis|Worm") float DistanceToTarget = 1.e9f;
	/** Цель — игрок, стоящий на камне (RockIsSafe). */
	UPROPERTY(BlueprintReadWrite, Category = "Rakis|Worm") bool bTargetSafe = false;
	/** Идёт DormantCooldown. */
	UPROPERTY(BlueprintReadWrite, Category = "Rakis|Worm") bool bCooldownActive = false;
	/** Запрошена езда (SetRidden(true)). */
	UPROPERTY(BlueprintReadWrite, Category = "Rakis|Worm") bool bRidden = false;
};

/**
 * Шай-Хулуд. 360 м, Ø 40 м, пасть-цветок из трёх лепестков.
 *
 * Тело: голова ведёт, тело идёт по её следу «как поезд» (история точек головы) + вертикальная
 * синусоида; по следу строится USplineComponent, вдоль него расставляются кольца
 * UInstancedStaticMeshComponent (SM_Worm_Segment; фоллбек — цилиндр движка).
 *
 * Автомат: Dormant → Listening → Approach → Surface → (Ridden | Pass) → Dormant.
 * «Мозг» (слух, автомат, угроза, звук, MPC) — таймер SenseHz (10 Гц); тело — Tick с интервалом
 * 1/MovementHz (30 Гц): движение 360-метрового тела обосновывает тик.
 */
UCLASS()
class RAKIS_API ARakisWorm : public AActor
{
	GENERATED_BODY()

public:
	ARakisWorm();

	UFUNCTION(BlueprintPure, Category = "Rakis|Worm")
	ERakisWormState GetState() const { return State; }

	/** 0..1 — для звука, UI, камеры, вибрации (сглажено). */
	UFUNCTION(BlueprintPure, Category = "Rakis|Worm")
	float GetThreat01() const { return Threat01; }

	/** Дистанция от головы до игрока, см (очень большое число, если игрока нет). */
	UFUNCTION(BlueprintPure, Category = "Rakis|Worm")
	float GetDistanceToPlayer() const { return DistanceToPlayer; }

	/** Центр головы в мире (подсказка для деформации песка/RVT). */
	UFUNCTION(BlueprintPure, Category = "Rakis|Worm")
	FVector GetHeadLocation() const { return HeadLocation; }

	UFUNCTION(BlueprintPure, Category = "Rakis|Worm")
	FRotator GetHeadRotation() const { return HeadRotation; }

	/** Высота поверхности песка под головой (кэш трассировки). */
	UFUNCTION(BlueprintPure, Category = "Rakis|Worm")
	float GetGroundZ() const { return GroundZ; }

	/** Последний взвешенный шум, услышанный червём. */
	UFUNCTION(BlueprintPure, Category = "Rakis|Worm")
	float GetHeardNoise() const { return HeardNoise; }

	/** Выход на поверхность в точке Location лицом в Facing (кат-сцена / StoryDirector ForceWorm). */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Worm")
	void ForceSurface(const FVector& Location, const FRotator& Facing);

	/** Наездники на спине: Surface → Ridden; false: Ridden → Pass. */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Worm")
	void SetRidden(bool bRidden);

	/** Включить/выключить слух (например, пока игрок в сиетче). ForceSurface работает всегда. */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Worm")
	void SetSensingEnabled(bool bEnabled) { bSensingEnabled = bEnabled; }

	UPROPERTY(BlueprintAssignable, Category = "Rakis|Worm")
	FOnWormStateChanged OnWormStateChanged;

	/** Голова пробила песок (FX/звук/кат-сцена). */
	UPROPERTY(BlueprintAssignable, Category = "Rakis|Worm")
	FOnWormBreach OnBreach;

	/** Раскрытие пасти 0..1 (анимация лепестков / параметр материала "MouthOpen"). */
	UPROPERTY(BlueprintReadOnly, Category = "Rakis|Worm")
	float MouthOpen01 = 0.f;

	/** Чистый автомат состояний (для тестов и отладки). */
	static ERakisWormState ComputeNextState(ERakisWormState Current, const FRakisWormSenseInput& In, const URakisWormTuning& Tuning);

	/** Чистая формула «сырой» угрозы 0..1. */
	static float ComputeThreat01(ERakisWormState InState, float InDistanceToPlayer, float Noise, float TimeInState, const URakisWormTuning& Tuning);

	virtual void Tick(float DeltaSeconds) override;
	virtual void OnConstruction(const FTransform& Transform) override;

protected:
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;

	// --- Компоненты ---
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Rakis|Worm")
	TObjectPtr<USceneComponent> SceneRoot;

	/** Ось тела (мировые точки, обновляется каждый кадр тела). */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Rakis|Worm")
	TObjectPtr<USplineComponent> BodySpline;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Rakis|Worm")
	TObjectPtr<UInstancedStaticMeshComponent> BodySegments;

	/** Неотмасштабированная опора головы (к ней крепятся меш головы и лепестки). */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Rakis|Worm")
	TObjectPtr<USceneComponent> HeadPivot;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Rakis|Worm")
	TObjectPtr<UStaticMeshComponent> HeadMesh;

	/** Кольца кристаллических зубов в глотке (SM_Worm_Teeth, тот же pivot и масштаб, что у головы). */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Rakis|Worm")
	TObjectPtr<UStaticMeshComponent> TeethMesh;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Rakis|Worm")
	TArray<TObjectPtr<USceneComponent>> PetalPivots;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Rakis|Worm")
	TArray<TObjectPtr<UStaticMeshComponent>> PetalMeshes;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Rakis|Worm|FX")
	TObjectPtr<UNiagaraComponent> SandWaveFX;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Rakis|Worm|FX")
	TObjectPtr<UNiagaraComponent> RockHopFX;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Rakis|Worm|FX")
	TArray<TObjectPtr<UNiagaraComponent>> RingSandfallFX;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Rakis|Worm|Audio")
	TObjectPtr<UAudioComponent> ApproachAudio;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Rakis|Worm|Audio")
	TObjectPtr<UAudioComponent> RoarAudio;

	// --- Ассеты (soft, всё необязательно для блокаута) ---
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Worm|Assets")
	TSoftObjectPtr<UStaticMesh> SegmentMeshAsset;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Worm|Assets")
	TSoftObjectPtr<UStaticMesh> HeadMeshAsset;

	/** Зубы глотки; показываются только вместе с авторской головой. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Worm|Assets")
	TSoftObjectPtr<UStaticMesh> TeethMeshAsset;

	/** Отдельный меш лепестка (ось X — от основания к кончику). Пусто + есть голова → только параметр "MouthOpen". */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Worm|Assets")
	TSoftObjectPtr<UStaticMesh> PetalMeshAsset;

	/** Материал для фоллбек-мешей (на авторские меши не ставится). */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Worm|Assets")
	TSoftObjectPtr<UMaterialInterface> FallbackBodyMaterial;

	/** Авторский сегмент вытянут по оси X (true) или по Z, как цилиндр движка (false). */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Worm|Assets")
	bool bSegmentMeshAlongX = true;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Worm|Assets")
	bool bHeadMeshAlongX = true;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Worm|FX")
	TSoftObjectPtr<UNiagaraSystem> SandWaveSystem;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Worm|FX")
	TSoftObjectPtr<UNiagaraSystem> RingSandfallSystem;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Worm|FX")
	TSoftObjectPtr<UNiagaraSystem> BreachSystem;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Worm|FX")
	TSoftObjectPtr<UNiagaraSystem> RockHopSystem;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Worm|Audio")
	TSoftObjectPtr<USoundBase> ApproachSound;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Worm|Audio")
	TSoftObjectPtr<USoundBase> RoarSound;

	// --- Поведение ---
	/** Тег точки покоя (контракт §2.4); если нет — точка покоя = позиция актора. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Worm")
	FName HomeTag = TEXT("Rakis.Worm.Spawn");

	UPROPERTY(EditAnywhere, Category = "Rakis|Worm")
	bool bSensingEnabled = true;

	/** Слать угрозу в ARakisPlayerController (тряска/вибрация) и MPC WormThreat01. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Worm")
	bool bDrivePlayerFeedback = true;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Worm")
	FName MouthParameterName = TEXT("MouthOpen");

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Worm")
	FName ThreatMPCParameterName = TEXT("WormThreat01");

	/** Угол лепестка: закрыт (кончики сходятся к оси) / раскрыт (цветок), град. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Worm|Body")
	float PetalClosedPitch = -62.f;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Worm|Body")
	float PetalOpenPitch = 42.f;

	/** Скорость раскрытия пасти, доля в секунду. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Worm|Body", meta = (ClampMin = "0.01"))
	float MouthSpeed = 0.7f;

	/** Перекрытие колец (1 — встык). */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Worm|Body", meta = (ClampMin = "0.5", ClampMax = "2"))
	float SegmentOverlap = 1.12f;

	/** Хвост сужается с этой доли длины до TailMinScale. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Worm|Body", meta = (ClampMin = "0", ClampMax = "1"))
	float TailTaperStart = 0.62f;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Worm|Body", meta = (ClampMin = "0.05", ClampMax = "1"))
	float TailMinScale = 0.3f;

	/** Шаг точек следа головы (доля длины сегмента). */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Worm|Body", meta = (ClampMin = "0.1", ClampMax = "2"))
	float TrailSpacingFactor = 0.5f;

	/** Каждые N сегментов — одна точка сплайна. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Worm|Body", meta = (ClampMin = "1", ClampMax = "16"))
	int32 SegmentsPerSplinePoint = 3;

	/** Сколько потоков песка с колец (компонентов Niagara). */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Worm|FX", meta = (ClampMin = "0", ClampMax = "8"))
	int32 RingSandfallCount = 4;

	/** При естественном выходе червь целит не в игрока, а мимо него на это расстояние вбок, см. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Worm|Body", meta = (ClampMin = "0"))
	float SurfacePassOffset = 3500.f;

	/** Скорость плавного поворота в Ridden, град/с. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Worm|Body")
	float RiddenYawRate = 2.f;

private:
	// Мозг
	void SenseUpdate();
	void SetState(ERakisWormState NewState);
	void UpdateFeedback(float DeltaSeconds);
	float GetNow() const;
	float TraceGroundZ(const FVector& Where, float FallbackZ) const;
	APawn* GetPlayerPawn() const;

	// Тело
	void LoadAssets(bool bForGameplay);
	void ResetPose(const FVector& InHeadLocation, float InYaw, float StartDepthBelowGround, float TailSlope);
	void UpdateMovement(float DeltaSeconds);
	void MoveHeadTo(const FVector& NewLocation, float DeltaSeconds);
	void UpdateSurfaceScript(float DeltaSeconds, const URakisWormTuning& Tuning);
	void UpdateBody();
	void UpdateHeadAndMouth(float DeltaSeconds);
	void UpdateEffects();
	void EnsureSegmentInstances(int32 Count);
	float ComputeSurfaceHeight(float T, float StartHeight, const URakisWormTuning& Tuning) const;
	void SetBodyVisible(bool bVisible);
	void ApplyNiagaraActive(UNiagaraComponent* Component, bool bActive, float Intensity);

	// Состояние
	ERakisWormState State = ERakisWormState::Dormant;
	float StateEnterTime = 0.f;
	float LastLoudTime = -1000.f;
	float CooldownEndTime = -1.f;
	float HeardNoise = 0.f;
	float Threat01 = 0.f;
	float DistanceToPlayer = 1.e9f;
	bool bRiddenRequested = false;
	bool bHasTarget = false;
	FVector Target = FVector::ZeroVector;

	FVector HomeLocation = FVector::ZeroVector;
	float WanderAngle = 0.f;

	// Голова и след
	FVector HeadLocation = FVector::ZeroVector;
	FRotator HeadRotation = FRotator::ZeroRotator;
	float HeadYaw = 0.f;
	float HeadPitch = 0.f;
	float GroundZ = 0.f;
	TArray<FVector> Trail;          // от старых (хвост) к новым (голова)

	// Скриптованный выход
	float SurfaceStartTime = 0.f;
	float SurfaceStartHeight = 0.f;
	float SurfaceAimYaw = 0.f;
	bool bForcedSurface = false;
	bool bBreachFired = false;
	float LastSenseTime = 0.f;
	bool bBodyVisible = true;
	bool bUsingFallbackHead = false;
	bool bUsingFallbackSegment = false;
	bool bUsingFallbackPetal = false;
	FVector PetalMeshSize = FVector(100.f);
	FVector SegmentMeshSize = FVector(100.f);
	FVector HeadMeshSize = FVector(100.f);

	UPROPERTY()
	TObjectPtr<UStaticMesh> FallbackCylinderMesh;

	UPROPERTY()
	TObjectPtr<UStaticMesh> FallbackCubeMesh;

	UPROPERTY(Transient)
	TObjectPtr<UMaterialInstanceDynamic> HeadMID;

	UPROPERTY(Transient)
	TObjectPtr<UMaterialParameterCollection> WeatherMPC;

	UPROPERTY(Transient)
	TObjectPtr<UNiagaraSystem> LoadedBreachSystem;

	FTimerHandle SenseTimer;
};
