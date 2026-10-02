#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "RakisCitizen.generated.h"

class UStaticMeshComponent;
class UMaterialInstanceDynamic;
class UAnimInstance;
class UStateTree;
class UStateTreeComponent;
class URakisCrowdSubsystem;

/** Текущая активность горожанина (для AnimBP и отладки). */
UENUM(BlueprintType)
enum class ERakisCitizenActivity : uint8
{
	Idle			UMETA(DisplayName = "Idle"),
	MovingToSpot	UMETA(DisplayName = "Moving To Spot"),
	UsingSpot		UMETA(DisplayName = "Using Spot"),
	Wandering		UMETA(DisplayName = "Wandering"),
	SteppingAside	UMETA(DisplayName = "Stepping Aside"),
	RitualWalk		UMETA(DisplayName = "Ritual Walk"),
	RitualGathered	UMETA(DisplayName = "Ritual Gathered")
};

/** Уровень детализации поведения по расстоянию до игрока (docs/tech/crowd.md §5). */
UENUM(BlueprintType)
enum class ERakisCitizenLOD : uint8
{
	Full		UMETA(DisplayName = "Full"),		// ≤ LowFrequencyRadius: полная частота
	Low			UMETA(DisplayName = "Low"),			// ≤ DormantRadius: StateTree/логика редко
	Dormant		UMETA(DisplayName = "Dormant")		// дальше: скрыт, движение и StateTree на паузе
};

/**
 * Горожанин сиетча «Табр-ан-Нур» (контракт §2.2 AI/, GDD §5 «NPC сиетча»).
 *
 * Два режима решений (docs/tech/crowd.md):
 *  1) StateTree: UStateTreeComponent (StateTreeComp) с ассетом StateTreeAsset (/Game/Rakis/AI/ST_Citizen,
 *     схема «StateTree Component», контекст-актор ARakisCitizen) и C++-задачами из RakisCitizenStateTree.h;
 *  2) C++-фоллбек (ассета нет, CVar Rakis.Crowd.StateTree 0 или дерево не запустилось) — прежний автомат ниже.
 * Точки — Smart Objects через URakisCrowdSubsystem (Claim → Occupy → Free), с теговым фоллбеком.
 * LOD (таймер 1 Гц): ≤ SignificanceRadius — полная частота; ≤ DormantRadius — StateTree/автомат редко;
 * дальше — скрыт, движение и дерево на паузе (кроме пути на ритуал).
 *
 * Поведение (таймер BehaviourHz, не Tick):
 *  - бродит между точками Rakis.SmartObject.<Type> своего архетипа (DT_CrowdArchetypes.SmartObjectTags),
 *    стоит на точке случайное время, на части точек «разговаривает»;
 *  - look-at игрока ближе LookAtRadius (LookAtTarget/bLookAtPlayer для AnimBP), стоя — доворачивает корпус;
 *  - уступает дорогу (шаг в сторону), если игрок ближе StepAsideRadius на его пути;
 *  - разговоры умолкают рядом с игроком (реестр в URakisCrowdSubsystem);
 *  - лай через URakisDialogueSubsystem::PlayBark (Stranger/Market/Water/Shiana/Ritual) с кулдаунами;
 *  - BeginRitualFlow — идти к точке сбора и смотреть в центр зала.
 */
UCLASS()
class RAKIS_API ARakisCitizen : public ACharacter
{
	GENERATED_BODY()

public:
	ARakisCitizen(const FObjectInitializer& ObjectInitializer = FObjectInitializer::Get());

	/** Архетип из DT_CrowdArchetypes: Trader, Artisan, WaterCarrier, Child, Guard, Pilgrim, Elder, Weaver. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Rakis|Crowd")
	FName Archetype = TEXT("Pilgrim");

	/** Зерно случайности (палитра, тайминги, выбор точек). Спавнер задаёт детерминированно. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Rakis|Crowd")
	int32 Seed = 0;

	/** Инициализация до BeginPlay (вызывает ARakisCrowdSpawner при отложенном спавне). */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Crowd")
	void InitCitizen(FName InArchetype, int32 InSeed);

	/** Идти к точке сбора в зале B5 и смотреть в центр зала. */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Crowd")
	void BeginRitualFlow(const FVector& GatherPoint);

	/** Вызывает реестр разговоров URakisCrowdSubsystem (или задача StateTree FallSilent). */
	void SetConversationSilenced(bool bSilenced);

	AActor* GetCurrentSpot() const { return CurrentSpot.Get(); }

	/** Решения принимает StateTree (иначе — C++-фоллбек). */
	UFUNCTION(BlueprintPure, Category = "Rakis|Crowd")
	bool IsUsingStateTree() const { return bUsingStateTree; }

	UFUNCTION(BlueprintPure, Category = "Rakis|Crowd")
	ERakisCitizenLOD GetBehaviourLOD() const { return BehaviourLOD; }

	// ---------- Примитивы поведения (C++: задачи StateTree и фоллбек) ----------

	/** Время мира, сек. */
	float GetWorldNow() const;
	/** Игрок (пешка 0) и расстояние до него; nullptr — игрока нет (Dist = MAX). */
	const APawn* GetPlayerAndDistance(float& OutDist) const;

	/** Прогулка к случайной достижимой точке (Radius ≤ 0 — WanderRadius). Activity = Wandering. */
	bool StartWander(float Radius);
	/** Зарезервировать точку своего архетипа (SO-слот) и пойти к ней (SearchRadius ≤ 0 — SpotSearchRadius). */
	bool ClaimSpotAndMove(float SearchRadius);
	/** Движение закончено (путь завершён/сорван или вышел дедлайн). */
	bool IsMoveFinished() const;
	/** Стоим у цели текущего движения (2D, допуск 150 см). */
	bool IsAtMoveGoal(float Tolerance = 150.f) const;
	/** Встать на точку: Occupy слота, доворот, разговор; длительность ≤ 0 — по поведению слота/SpotIdleMin..Max. */
	void ArriveAtSpot(float Now, float DurationMin = -1.f, float DurationMax = -1.f);
	/** Сойти с точки: тишина, освобождение слота, Activity = Idle. */
	void LeaveSpot();
	/** Время окончания текущей активности (UsingSpot/Idle). */
	float GetActivityEndTime() const { return ActivityEndTime; }
	/** Постоять (Idle) Duration сек. */
	void BeginIdle(float Duration);
	void StopMoving();
	void SetActivity(ERakisCitizenActivity NewActivity) { Activity = NewActivity; }

	/** Look-at игрока / центра зала (AnimBP) и доворот корпуса стоящего. */
	void UpdateLookAt(const APawn* Player, float DistToPlayer);
	void ClearLookAt();
	/** Нужно ли уступить дорогу (без побочных эффектов, учитывает кулдаун). */
	bool ShouldYieldToPlayer(const APawn* Player, float DistToPlayer, float Now) const;
	/** Шаг в сторону от игрока (Activity = SteppingAside). false — не нужно/не вышло. */
	bool StepAsideFromPlayer(const APawn* Player, float DistToPlayer, float Now);

	/** Ритуал: запрошен ли (BeginRitualFlow), начать путь к точке сбора и обновить его (true — пришёл). */
	bool IsRitualRequested() const { return bRitualRequested; }
	void BeginRitualWalk(float Now);
	bool UpdateRitualWalk(float Now);

	/** Тишину разговора ведёт StateTree-задача FallSilent (реестр URakisCrowdSubsystem её не трогает). */
	bool IsSilenceDrivenByStateTree() const { return bSilenceDrivenByStateTree; }
	void SetSilenceDrivenByStateTree(bool bDriven) { bSilenceDrivenByStateTree = bDriven; }

	// ---------- Для AnimBP ----------

	/** Точка взгляда (голова игрока, центр зала и т.п.). */
	UPROPERTY(BlueprintReadOnly, Category = "Rakis|Crowd|Anim")
	FVector LookAtTarget = FVector::ZeroVector;

	/** Смотреть ли на игрока (AnimBP: Look At / Control Rig головы). */
	UPROPERTY(BlueprintReadOnly, Category = "Rakis|Crowd|Anim")
	bool bLookAtPlayer = false;

	/** Есть ли вообще цель взгляда (игрок или центр зала). */
	UPROPERTY(BlueprintReadOnly, Category = "Rakis|Crowd|Anim")
	bool bHasLookAtTarget = false;

	/** Участвует в разговоре (жесты); пока bConversationSilenced — пауза. */
	UPROPERTY(BlueprintReadOnly, Category = "Rakis|Crowd|Anim")
	bool bIsTalking = false;

	/** Разговор поставлен на паузу из-за игрока рядом. */
	UPROPERTY(BlueprintReadOnly, Category = "Rakis|Crowd|Anim")
	bool bConversationSilenced = false;

	UPROPERTY(BlueprintReadOnly, Category = "Rakis|Crowd|Anim")
	ERakisCitizenActivity Activity = ERakisCitizenActivity::Idle;

	/** Тип текущей точки (Loom, Stall, ...) — для выбора idle-анимации в AnimBP. */
	UPROPERTY(BlueprintReadOnly, Category = "Rakis|Crowd|Anim")
	FName CurrentSpotType;

	// ---------- Тюнинг ----------

	/** Частота логики поведения, Гц (4–10). */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Crowd|Behaviour", meta = (ClampMin = "1.0", ClampMax = "20.0"))
	float BehaviourHz = 5.f;

	/** Дальше этого от игрока поведение обновляется редко (LOD Low), см. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Crowd|Behaviour")
	float SignificanceRadius = 4000.f;

	/** Дальше этого — горожанин скрыт и «спит» (LOD Dormant), кроме пути на ритуал, см. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Crowd|LOD")
	float DormantRadius = 7000.f;

	/** Гистерезис LOD, см (чтобы не мигать на границе). */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Crowd|LOD")
	float LODHysteresis = 300.f;

	/** Интервал тика StateTree в LOD Low, сек. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Crowd|LOD", meta = (ClampMin = "0.05"))
	float LowLODTickInterval = 0.5f;

	/** Период пересчёта LOD, сек. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Crowd|LOD", meta = (ClampMin = "0.1"))
	float LODUpdateInterval = 1.f;

	/** Ассет StateTree (схема «StateTree Component», контекст-актор — этот класс). Нет ассета — C++-фоллбек. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Crowd|StateTree")
	TSoftObjectPtr<UStateTree> StateTreeAsset = TSoftObjectPtr<UStateTree>(FSoftObjectPath(TEXT("/Game/Rakis/AI/ST_Citizen.ST_Citizen")));

	/** Компонент StateTree (запускается в BeginPlay, если ассет найден). */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Rakis|Crowd|StateTree")
	TObjectPtr<UStateTreeComponent> StateTreeComp;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Crowd|Behaviour")
	float SpotSearchRadius = 3500.f;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Crowd|Behaviour")
	float WanderRadius = 1200.f;

	/** Вероятность выбрать точку (иначе — прогулка). */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Crowd|Behaviour", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float SpotChance = 0.75f;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Crowd|Behaviour")
	float SpotIdleMin = 10.f;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Crowd|Behaviour")
	float SpotIdleMax = 30.f;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Crowd|Behaviour")
	float WanderIdleMin = 2.f;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Crowd|Behaviour")
	float WanderIdleMax = 7.f;

	/** Вероятность «разговаривать» на точке. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Crowd|Behaviour", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float TalkChance = 0.45f;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Crowd|Reactions")
	float LookAtRadius = 600.f;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Crowd|Reactions")
	float StepAsideRadius = 150.f;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Crowd|Reactions")
	float StepAsideDistance = 140.f;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Crowd|Reactions")
	float StepAsideCooldown = 2.f;

	/** Если угол до игрока больше — доворачиваем корпус (голова дальше не достаёт), градусы. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Crowd|Reactions")
	float BodyTurnThresholdDeg = 70.f;

	/** Скорость доворота корпуса (RInterpTo). */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Crowd|Reactions")
	float TurnInterpSpeed = 4.f;

	/** Дальше этого реплики не играются (игрок не услышит), см. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Crowd|Barks")
	float BarkRadius = 1200.f;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Crowd|Barks")
	float StrangerBarkRadius = 350.f;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Crowd|Barks", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float StrangerBarkChance = 0.35f;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Crowd|Barks")
	float StrangerBarkCooldown = 90.f;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Crowd|Barks")
	float BarkCooldownMin = 25.f;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Crowd|Barks")
	float BarkCooldownMax = 50.f;

	/** Вероятность фразы во время пути на ритуал (за бросок; броски раз в 3–8 с после кулдауна). */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Crowd|Barks", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float RitualBarkChance = 0.35f;

	/** Звук работы на точке (SmartObject:<Type>) слышен игроку ближе этого, см. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Crowd|Audio")
	float SpotSoundRadius = 1500.f;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Crowd|Audio")
	float SpotSoundIntervalMin = 6.f;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Crowd|Audio")
	float SpotSoundIntervalMax = 14.f;

	/** Векторный параметр цвета ткани в материалах одежды (M_Cloth_Worn). */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Crowd|Visual")
	FName ClothTintParam = TEXT("ClothTint");

	/** Меш, если в архетипе BaseMesh пуст/не найден (манекен шаблона UE). */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Crowd|Visual")
	FSoftObjectPath FallbackMesh = FSoftObjectPath(TEXT("/Game/Characters/Mannequins/Meshes/SKM_Quinn_Simple.SKM_Quinn_Simple"));

	/** Анимкласс для архетипного меша (пусто — оставить анимкласс меша/BP). */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Crowd|Visual")
	TSoftClassPtr<UAnimInstance> AnimClass;

	/** Анимкласс для фоллбек-манекена. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Crowd|Visual")
	TSoftClassPtr<UAnimInstance> FallbackAnimClass = TSoftClassPtr<UAnimInstance>(FSoftObjectPath(TEXT("/Game/Characters/Mannequins/Anims/Unarmed/ABP_Unarmed.ABP_Unarmed_C")));

	/** Заглушка-цилиндр для блокаута без контента. */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Rakis|Crowd|Visual")
	TObjectPtr<UStaticMeshComponent> PlaceholderBody;

protected:
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;
	virtual void Tick(float DeltaSeconds) override;

private:
	void ApplyArchetype();
	void TryStartStateTree();
	void FallBackToCpp(const TCHAR* Reason);
	void BehaviourUpdate();
	void UpdateReactions(const APawn* Player, float Dist, float Now);
	void UpdateLOD();
	void SetLOD(ERakisCitizenLOD NewLOD);
	void ChooseNextActivity(float Now);
	void ReleaseCurrentSpot();
	void SetTalking(bool bTalking);

	bool MoveToPoint(const FVector& Destination, float AcceptanceRadius);
	bool IsMoveDone() const;

	bool ComputeStepAsideTarget(const APawn* Player, float DistToPlayer, float Now, FVector& OutTarget) const;
	bool TryStepAside(const APawn* Player, float DistToPlayer, float Now);
	void ResumeAfterStepAside(float Now);
	void RequestTurnTo(float Yaw);
	void UpdateBarks(const APawn* Player, float DistToPlayer, float Now);
	bool PlayBark(FName Context);
	void UpdateSpotSound(float DistToPlayer, float Now);

	URakisCrowdSubsystem* GetCrowd() const;

	FRandomStream Rng;
	FTimerHandle BehaviourTimer;
	FTimerHandle LODTimer;

	bool bUsingStateTree = false;
	int32 StateTreeRestarts = 0;
	float LastStateTreeRestartTime = -100.f;
	/** Если StateTree не взял ритуал к этому времени — ритуал ведёт C++. */
	float RitualStateTreeDeadline = 0.f;
	bool bSilenceDrivenByStateTree = false;
	ERakisCitizenLOD BehaviourLOD = ERakisCitizenLOD::Full;
	uint32 LowLODCounter = 0;

	TWeakObjectPtr<AActor> CurrentSpot;
	/** Куда смотреть на точке (yaw слота SO или маркера). */
	float CurrentSpotYaw = 0.f;
	FVector MoveGoal = FVector::ZeroVector;
	float ActivityEndTime = 0.f;
	float MoveDeadline = 0.f;

	/** Куда вернуться после шага в сторону. */
	ERakisCitizenActivity ResumeActivity = ERakisCitizenActivity::Idle;
	FVector ResumeGoal = FVector::ZeroVector;
	float NextStepAsideTime = 0.f;

	FVector RitualGatherPoint = FVector::ZeroVector;
	bool bRitualRequested = false;
	float RitualRetryTime = 0.f;
	FVector HallCentre = FVector::ZeroVector;
	bool bHasHallCentre = false;

	float NextBarkTime = 0.f;
	float NextSpotSoundTime = 0.f;
	float NextStrangerBarkTime = 0.f;
	bool bPlayerWasClose = false;

	bool bWantsTurn = false;
	float DesiredYaw = 0.f;
	float BaseWalkSpeed = 120.f;
	bool bInitialized = false;

	UPROPERTY(Transient)
	TArray<TObjectPtr<UMaterialInstanceDynamic>> TintMIDs;
};
