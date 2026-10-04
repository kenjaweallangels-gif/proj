#pragma once

#include "CoreMinimal.h"
#include "StateTreeConditionBase.h"
#include "StateTreeEvaluatorBase.h"
#include "StateTreeExecutionTypes.h"
#include "StateTreeTaskBase.h"
#include "AI/RakisCitizen.h"
#include "Core/RakisTypes.h"
#include "RakisCitizenStateTree.generated.h"

/**
 * C++-узлы StateTree горожанина (ST_Citizen, схема «StateTree Component», контекст-актор ARakisCitizen).
 * Узлы — тонкие обёртки над примитивами ARakisCitizen (те же, что у C++-фоллбека), поэтому поведение
 * в обоих режимах одинаковое. Сборка дерева в редакторе — docs/tech/crowd.md §3.
 *
 * Горожанин берётся из Context.GetOwner(): владелец UStateTreeComponent (сам ARakisCitizen) или,
 * если компонент повесят на AI-контроллер, его пешка.
 */

// =============================================================================================
// Evaluator
// =============================================================================================

USTRUCT()
struct RAKIS_API FRakisSTCitizenSenseInstanceData
{
	GENERATED_BODY()

	/** Сам горожанин (для привязок свойств). */
	UPROPERTY(EditAnywhere, Category = "Output")
	TObjectPtr<ARakisCitizen> Citizen = nullptr;

	UPROPERTY(EditAnywhere, Category = "Output")
	bool bHasPlayer = false;

	/** Расстояние до игрока, см (очень большое, если игрока нет). */
	UPROPERTY(EditAnywhere, Category = "Output")
	float PlayerDistance = 1.0e9f;

	UPROPERTY(EditAnywhere, Category = "Output")
	FVector PlayerLocation = FVector::ZeroVector;

	/** Зона игрока (URakisZoneSubsystem). */
	UPROPERTY(EditAnywhere, Category = "Output")
	ERakisZone PlayerZone = ERakisZone::None;

	/** Толпу позвали на ритуал (BeginRitualFlow). */
	UPROPERTY(EditAnywhere, Category = "Output")
	bool bRitualRequested = false;

	/** Игрок идёт на горожанина / горожанин на игрока — пора уступить дорогу. */
	UPROPERTY(EditAnywhere, Category = "Output")
	bool bPlayerBlocking = false;

	/** Игрок ближе LookAtRadius горожанина. */
	UPROPERTY(EditAnywhere, Category = "Output")
	bool bPlayerNear = false;

	UPROPERTY(EditAnywhere, Category = "Output")
	bool bIsTalking = false;

	UPROPERTY(EditAnywhere, Category = "Output")
	ERakisCitizenActivity Activity = ERakisCitizenActivity::Idle;

	UPROPERTY(EditAnywhere, Category = "Output")
	ERakisCitizenLOD LOD = ERakisCitizenLOD::Full;
};

/** Чувства горожанина: дистанция/зона игрока, флаг ритуала, «игрок на пути». */
USTRUCT(meta = (DisplayName = "Rakis Citizen Sense", Category = "Rakis|Crowd"))
struct RAKIS_API FRakisSTEval_CitizenSense : public FStateTreeEvaluatorCommonBase
{
	GENERATED_BODY()

	using FInstanceDataType = FRakisSTCitizenSenseInstanceData;

	virtual const UStruct* GetInstanceDataType() const override { return FInstanceDataType::StaticStruct(); }
	virtual void TreeStart(FStateTreeExecutionContext& Context) const override;
	virtual void Tick(FStateTreeExecutionContext& Context, const float DeltaTime) const override;
};

// =============================================================================================
// Conditions
// =============================================================================================

/** Толпу позвали на ритуал. */
USTRUCT(meta = (DisplayName = "Rakis Ritual Requested", Category = "Rakis|Crowd"))
struct RAKIS_API FRakisSTCond_RitualRequested : public FStateTreeConditionCommonBase
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, Category = "Parameter")
	bool bInvert = false;

	virtual bool TestCondition(FStateTreeExecutionContext& Context) const override;
};

/** Игрок на пути (то же правило, что у фоллбека: ≤ StepAsideRadius и движение навстречу, с кулдауном). */
USTRUCT(meta = (DisplayName = "Rakis Should Yield To Player", Category = "Rakis|Crowd"))
struct RAKIS_API FRakisSTCond_ShouldYieldToPlayer : public FStateTreeConditionCommonBase
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, Category = "Parameter")
	bool bInvert = false;

	virtual bool TestCondition(FStateTreeExecutionContext& Context) const override;
};

// =============================================================================================
// Tasks
// =============================================================================================

USTRUCT()
struct RAKIS_API FRakisSTWanderInstanceData
{
	GENERATED_BODY()

	/** Радиус прогулки, см; ≤ 0 — WanderRadius горожанина. */
	UPROPERTY(EditAnywhere, Category = "Parameter")
	float Radius = -1.f;
};

/** Прогулка к случайной достижимой точке. Succeeded — дошёл, Failed — некуда идти. */
USTRUCT(meta = (DisplayName = "Rakis Wander", Category = "Rakis|Crowd"))
struct RAKIS_API FRakisSTTask_Wander : public FStateTreeTaskCommonBase
{
	GENERATED_BODY()

	using FInstanceDataType = FRakisSTWanderInstanceData;

	virtual const UStruct* GetInstanceDataType() const override { return FInstanceDataType::StaticStruct(); }
	virtual EStateTreeRunStatus EnterState(FStateTreeExecutionContext& Context, const FStateTreeTransitionResult& Transition) const override;
	virtual EStateTreeRunStatus Tick(FStateTreeExecutionContext& Context, const float DeltaTime) const override;
	virtual void ExitState(FStateTreeExecutionContext& Context, const FStateTreeTransitionResult& Transition) const override;
};

USTRUCT()
struct RAKIS_API FRakisSTIdleInstanceData
{
	GENERATED_BODY()

	/** Пауза, сек; ≤ 0 — WanderIdleMin/Max горожанина. */
	UPROPERTY(EditAnywhere, Category = "Parameter")
	float DurationMin = -1.f;

	UPROPERTY(EditAnywhere, Category = "Parameter")
	float DurationMax = -1.f;
};

/** Постоять на месте (Activity = Idle) случайное время. */
USTRUCT(meta = (DisplayName = "Rakis Idle", Category = "Rakis|Crowd"))
struct RAKIS_API FRakisSTTask_Idle : public FStateTreeTaskCommonBase
{
	GENERATED_BODY()

	using FInstanceDataType = FRakisSTIdleInstanceData;

	virtual const UStruct* GetInstanceDataType() const override { return FInstanceDataType::StaticStruct(); }
	virtual EStateTreeRunStatus EnterState(FStateTreeExecutionContext& Context, const FStateTreeTransitionResult& Transition) const override;
	virtual EStateTreeRunStatus Tick(FStateTreeExecutionContext& Context, const float DeltaTime) const override;
};

USTRUCT()
struct RAKIS_API FRakisSTUseSmartObjectInstanceData
{
	GENERATED_BODY()

	/** Радиус поиска точки, см; ≤ 0 — SpotSearchRadius горожанина. */
	UPROPERTY(EditAnywhere, Category = "Parameter")
	float SearchRadius = -1.f;

	/** Сколько стоять на точке, сек; ≤ 0 — из поведения слота SO, затем SpotIdleMin/Max горожанина. */
	UPROPERTY(EditAnywhere, Category = "Parameter")
	float UseDurationMin = -1.f;

	UPROPERTY(EditAnywhere, Category = "Parameter")
	float UseDurationMax = -1.f;

	/** Тип занятой точки (Loom, Stall, ...). */
	UPROPERTY(EditAnywhere, Category = "Output")
	FName SpotType;

	/** 0 — идём к точке, 1 — на точке (внутреннее состояние). */
	uint8 Phase = 0;
};

/**
 * Найти точку своего архетипа (USmartObjectSubsystem: FindSmartObjects → MarkSlotAsClaimed), дойти,
 * занять (MarkSlotAsOccupied), «работать»/разговаривать заданное время, освободить (MarkSlotAsFree — в ExitState).
 * Succeeded — отработал; Failed — нет свободной точки или не дошёл.
 */
USTRUCT(meta = (DisplayName = "Rakis Find And Use Smart Object", Category = "Rakis|Crowd"))
struct RAKIS_API FRakisSTTask_FindAndUseSmartObject : public FStateTreeTaskCommonBase
{
	GENERATED_BODY()

	using FInstanceDataType = FRakisSTUseSmartObjectInstanceData;

	virtual const UStruct* GetInstanceDataType() const override { return FInstanceDataType::StaticStruct(); }
	virtual EStateTreeRunStatus EnterState(FStateTreeExecutionContext& Context, const FStateTreeTransitionResult& Transition) const override;
	virtual EStateTreeRunStatus Tick(FStateTreeExecutionContext& Context, const float DeltaTime) const override;
	virtual void ExitState(FStateTreeExecutionContext& Context, const FStateTreeTransitionResult& Transition) const override;
};

/**
 * Look-at игрока (≤ LookAtRadius; стоящий доворачивает корпус) и центра зала на ритуале. Работает бесконечно —
 * ставить глобальной задачей корня. Не участвует в завершении состояния.
 */
USTRUCT(meta = (DisplayName = "Rakis Look At Player", Category = "Rakis|Crowd"))
struct RAKIS_API FRakisSTTask_LookAtPlayer : public FStateTreeTaskCommonBase
{
	GENERATED_BODY()

	FRakisSTTask_LookAtPlayer();

	virtual EStateTreeRunStatus EnterState(FStateTreeExecutionContext& Context, const FStateTreeTransitionResult& Transition) const override;
	virtual EStateTreeRunStatus Tick(FStateTreeExecutionContext& Context, const float DeltaTime) const override;
	virtual void ExitState(FStateTreeExecutionContext& Context, const FStateTreeTransitionResult& Transition) const override;
};

/** Шаг в сторону с пути игрока. Succeeded — отошёл; Failed — уступать не нужно/некуда. */
USTRUCT(meta = (DisplayName = "Rakis Yield To Player", Category = "Rakis|Crowd"))
struct RAKIS_API FRakisSTTask_YieldToPlayer : public FStateTreeTaskCommonBase
{
	GENERATED_BODY()

	virtual EStateTreeRunStatus EnterState(FStateTreeExecutionContext& Context, const FStateTreeTransitionResult& Transition) const override;
	virtual EStateTreeRunStatus Tick(FStateTreeExecutionContext& Context, const float DeltaTime) const override;
	virtual void ExitState(FStateTreeExecutionContext& Context, const FStateTreeTransitionResult& Transition) const override;
};

USTRUCT()
struct RAKIS_API FRakisSTFallSilentInstanceData
{
	GENERATED_BODY()

	/** Игрок ближе — разговор умолкает, см. */
	UPROPERTY(EditAnywhere, Category = "Parameter")
	float SilenceRadius = 400.f;

	/** Игрок дальше этого ResumeDelay секунд — разговор продолжается, см. */
	UPROPERTY(EditAnywhere, Category = "Parameter")
	float ResumeRadius = 550.f;

	UPROPERTY(EditAnywhere, Category = "Parameter")
	float ResumeDelay = 1.5f;

	/** Внутреннее: с какого времени игрок далеко (< 0 — нет). */
	float ClearSince = -1.f;
};

/**
 * Разговор умолкает рядом с игроком и продолжается после (bConversationSilenced для AnimBP, лай молчит).
 * Пока задача активна, реестр URakisCrowdSubsystem этим горожанином не управляет (звук Crowd:PlayerNear остаётся).
 * Работает бесконечно — глобальная задача корня или задача состояния «на точке».
 */
USTRUCT(meta = (DisplayName = "Rakis Fall Silent", Category = "Rakis|Crowd"))
struct RAKIS_API FRakisSTTask_FallSilent : public FStateTreeTaskCommonBase
{
	GENERATED_BODY()

	using FInstanceDataType = FRakisSTFallSilentInstanceData;

	FRakisSTTask_FallSilent();

	virtual const UStruct* GetInstanceDataType() const override { return FInstanceDataType::StaticStruct(); }
	virtual EStateTreeRunStatus EnterState(FStateTreeExecutionContext& Context, const FStateTreeTransitionResult& Transition) const override;
	virtual EStateTreeRunStatus Tick(FStateTreeExecutionContext& Context, const float DeltaTime) const override;
	virtual void ExitState(FStateTreeExecutionContext& Context, const FStateTreeTransitionResult& Transition) const override;
};

USTRUCT()
struct RAKIS_API FRakisSTGoToRitualInstanceData
{
	GENERATED_BODY()

	/** Дошёл до точки сбора и смотрит в центр зала. */
	UPROPERTY(EditAnywhere, Category = "Output")
	bool bGathered = false;
};

/**
 * Идти к точке сбора (выдаётся URakisCrowdSubsystem::StartRitual → BeginRitualFlow) и стоять лицом к центру зала.
 * Running бесконечно; Failed — ритуал не запрошен.
 */
USTRUCT(meta = (DisplayName = "Rakis Go To Ritual", Category = "Rakis|Crowd"))
struct RAKIS_API FRakisSTTask_GoToRitual : public FStateTreeTaskCommonBase
{
	GENERATED_BODY()

	using FInstanceDataType = FRakisSTGoToRitualInstanceData;

	virtual const UStruct* GetInstanceDataType() const override { return FInstanceDataType::StaticStruct(); }
	virtual EStateTreeRunStatus EnterState(FStateTreeExecutionContext& Context, const FStateTreeTransitionResult& Transition) const override;
	virtual EStateTreeRunStatus Tick(FStateTreeExecutionContext& Context, const float DeltaTime) const override;
};
