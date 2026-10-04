#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "RakisCompanion.generated.h"

class UStaticMeshComponent;
class UMaterialInstanceDynamic;
class UAnimInstance;

/**
 * Спутник игрока (Илва, Рэйн, Оссана) — контракт §2.2 AI/, сценарий 0:00–0:25 «трое идут цепочкой».
 *
 * Следование цепочкой по «следам»: спутник записывает хлебные крошки позиций игрока и идёт ровно по ним
 * (на песке — след в след, что не добавляет шума и читается как фрименская дисциплина).
 * Номер в цепочке ChainIndex: 1 — сразу за игроком (ChainSpacing см), 2 — за первым и т.д.
 * Скорость подстраивается под игрока; отстав — догоняет. Игрок стоит — спутник стоит, смотрит на него.
 * Застрял/потерялся — восстановление через AI MoveTo с навигацией, крайний случай — телепорт на след вне кадра.
 * До первой встречи (игрок дальше JoinRadius) спутник ждёт на месте (Оссана ждёт у A3).
 */
UCLASS()
class RAKIS_API ARakisCompanion : public ACharacter
{
	GENERATED_BODY()

public:
	ARakisCompanion(const FObjectInitializer& ObjectInitializer = FObjectInitializer::Get());

	/** Ilva, Rayn, Ossana. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Rakis|Companion")
	FName CompanionId;

	/** Место в цепочке (1 — сразу за игроком). 0 — авто: Ilva=1, Rayn=2, Ossana=3. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Rakis|Companion", meta = (ClampMin = "0"))
	int32 ChainIndex = 0;

	/** Включить/выключить следование (кат-сцены, сюжетные стойки). */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Companion")
	void SetFollowEnabled(bool bEnabled);

	UFUNCTION(BlueprintPure, Category = "Rakis|Companion")
	bool IsFollowing() const { return bFollowEnabled && bJoined; }

	/** Сбросить след (после телепорта игрока/кат-сцены) — спутник пойдёт к игроку напрямую. */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Companion")
	void ResetTrail();

	// ---------- Для AnimBP ----------

	UPROPERTY(BlueprintReadOnly, Category = "Rakis|Companion|Anim")
	FVector LookAtTarget = FVector::ZeroVector;

	UPROPERTY(BlueprintReadOnly, Category = "Rakis|Companion|Anim")
	bool bLookAtPlayer = false;

	// ---------- Тюнинг ----------

	/** Расстояние между звеньями цепочки, см (3–4 м). */
	UPROPERTY(EditAnywhere, Category = "Rakis|Companion|Follow", meta = (ClampMin = "100.0"))
	float ChainSpacing = 350.f;

	/** Шаг записи следа, см. */
	UPROPERTY(EditAnywhere, Category = "Rakis|Companion|Follow", meta = (ClampMin = "10.0"))
	float CrumbSpacing = 40.f;

	/** Крошка считается пройденной ближе этого, см. */
	UPROPERTY(EditAnywhere, Category = "Rakis|Companion|Follow")
	float CrumbReachRadius = 55.f;

	/** Допуск по дистанции цепочки, см (меньше — стоим). */
	UPROPERTY(EditAnywhere, Category = "Rakis|Companion|Follow")
	float GapTolerance = 40.f;

	/** Коэффициент догоняния: см/с добавки на каждый см отставания. */
	UPROPERTY(EditAnywhere, Category = "Rakis|Companion|Follow")
	float CatchUpGain = 0.8f;

	UPROPERTY(EditAnywhere, Category = "Rakis|Companion|Follow")
	float MinWalkSpeed = 90.f;

	UPROPERTY(EditAnywhere, Category = "Rakis|Companion|Follow")
	float MaxCatchUpSpeed = 480.f;

	/** Игрок ближе — спутник «присоединяется» к цепочке, см. */
	UPROPERTY(EditAnywhere, Category = "Rakis|Companion|Follow")
	float JoinRadius = 1500.f;

	/** Дальше — восстановление через навигацию, см. */
	UPROPERTY(EditAnywhere, Category = "Rakis|Companion|Follow")
	float RecoverDistance = 2500.f;

	/** Дальше — телепорт на след (если не в кадре), см. */
	UPROPERTY(EditAnywhere, Category = "Rakis|Companion|Follow")
	float TeleportDistance = 6000.f;

	/** Нет прогресса столько секунд — считаем, что застряли. */
	UPROPERTY(EditAnywhere, Category = "Rakis|Companion|Follow")
	float StuckSeconds = 2.5f;

	/** Частота логики (ограничения скорости, look-at, восстановление), Гц. Рулёжка по следу — каждый кадр. */
	UPROPERTY(EditAnywhere, Category = "Rakis|Companion|Follow", meta = (ClampMin = "1.0", ClampMax = "30.0"))
	float LogicHz = 10.f;

	/** Длина шага для звука шагов, см (фоллбек без AnimNotify). */
	UPROPERTY(EditAnywhere, Category = "Rakis|Companion|Audio")
	float StrideLength = 75.f;

	UPROPERTY(EditAnywhere, Category = "Rakis|Companion|Audio")
	float FootstepAudibleRadius = 2500.f;

	UPROPERTY(EditAnywhere, Category = "Rakis|Companion|Look")
	float LookAtRadius = 900.f;

	/** Сколько игрок должен простоять, чтобы спутник повернулся к нему, сек. */
	UPROPERTY(EditAnywhere, Category = "Rakis|Companion|Look")
	float IdleTurnDelay = 0.75f;

	UPROPERTY(EditAnywhere, Category = "Rakis|Companion|Look")
	float TurnInterpSpeed = 3.f;

	UPROPERTY(EditAnywhere, Category = "Rakis|Companion|Visual")
	FSoftObjectPath FallbackMesh = FSoftObjectPath(TEXT("/Game/Characters/Mannequins/Meshes/SKM_Quinn_Simple.SKM_Quinn_Simple"));

	/** Путь к мешу героя (MetaHuman-база); пусто — фоллбек. */
	UPROPERTY(EditAnywhere, Category = "Rakis|Companion|Visual")
	FString HeroMeshPath;

	UPROPERTY(EditAnywhere, Category = "Rakis|Companion|Visual")
	TSoftClassPtr<UAnimInstance> AnimClass;

	UPROPERTY(EditAnywhere, Category = "Rakis|Companion|Visual")
	TSoftClassPtr<UAnimInstance> FallbackAnimClass = TSoftClassPtr<UAnimInstance>(FSoftObjectPath(TEXT("/Game/Characters/Mannequins/Anims/Unarmed/ABP_Unarmed.ABP_Unarmed_C")));

	/** Цвет одежды-заглушки (Илва — пыльный индиго, Рэйн — охра, Оссана — тёмная кожа). */
	UPROPERTY(EditAnywhere, Category = "Rakis|Companion|Visual")
	FLinearColor ClothTint = FLinearColor(0.35f, 0.3f, 0.25f);

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Companion|Visual")
	FName ClothTintParam = TEXT("ClothTint");

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Rakis|Companion|Visual")
	TObjectPtr<UStaticMeshComponent> PlaceholderBody;

protected:
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;
	virtual void Tick(float DeltaSeconds) override;

private:
	void LogicUpdate();
	void RecordCrumb(const FVector& PlayerLocation);
	float TrailLengthFromCursor(const FVector& PlayerLocation) const;
	void AdvanceCursor();
	void StartRecovery(const APawn* Player);
	void TeleportBehindPlayer(const APawn* Player);
	FVector PointOnTrailBehindPlayer(const FVector& PlayerLocation, float Distance) const;
	int32 ResolveChainIndex() const;

	/** След игрока (старые — в начале). */
	TArray<FVector> Crumbs;
	/** Индекс крошки, к которой идём. */
	int32 Cursor = 0;

	FTimerHandle LogicTimer;
	bool bFollowEnabled = true;
	bool bJoined = false;
	bool bRecovering = false;
	bool bMovingOnTrail = false;
	float DesiredSpeed = 150.f;
	float PlayerStillTime = 0.f;
	float LastProgressTime = 0.f;
	FVector LastProgressLocation = FVector::ZeroVector;
	float LastLogicTime = 0.f;
	float StrideAccumulator = 0.f;

	UPROPERTY(Transient)
	TArray<TObjectPtr<UMaterialInstanceDynamic>> TintMIDs;
};
