#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "TimerManager.h"
#include "Core/RakisTypes.h"
#include "Core/RakisDataTypes.h"
#include "RakisStoryDirector.generated.h"

class ARakisWorm;
class ARakisCinematicTrigger;
class URakisInteractionComponent;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FRakisOnTitleCard, FText, Title, float, Duration);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FRakisOnHint, FText, Hint);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FRakisOnStoryBeat, FName, BeatID);

/** Фаза склейки-эллипсиса. */
enum class ERakisEllipsisPhase : uint8
{
	None,
	Offer,		// ждём «золотого» момента
	FadingOut,	// в чёрное
	Black,		// перенос сделан, титр поверх чёрного
	FadingIn	// возврат картинки (бит уже завершён)
};

/** Состояние текущей склейки (одна за раз). */
struct FRakisEllipsisState
{
	ERakisEllipsisPhase Phase = ERakisEllipsisPhase::None;
	int32 BeatIndex = INDEX_NONE;
	FName TargetTag = NAME_None;
	TWeakObjectPtr<AActor> Target;
	float FadeSeconds = 1.2f;
	float AdvanceHours = 0.f;
	double OfferDeadline = 0.0;
	FString CardPipe;
	/** pull=<BeatID>@<сек>: после склейки бит исполнится не позже чем через столько секунд. */
	TArray<TPair<FName, float>> Pulls;
	/** Зона игрока до переноса. */
	ERakisZone SourceZone = ERakisZone::None;
	/** Триггеры ZoneEnter, пришедшие во время чёрного, — исполняются после возврата картинки. */
	TArray<FName> DeferredTriggers;
	FString LastRejectReason;
};

/** Бит сюжета во время игры (строка DT_StoryBeats + состояние). */
struct FRakisRuntimeBeat
{
	FName BeatID = NAME_None;
	FRakisStoryBeatRow Row;
	bool bFired = false;
	bool bCompleted = false;
	/** Для Trigger = NoiseAbove:<x> — порог, иначе < 0. */
	float NoiseThreshold = -1.f;
	FTimerHandle DelayTimer;
};

/**
 * Сюжетный директор (контракт §2.2 Narrative/): один на уровень, тег Rakis.Story.
 * Исполняет DT_StoryBeats (по Order). Триггеры: Start, ZoneEnter:<Zone>, Beat:<BeatID> (после завершения бита),
 * WormState:<State>, NoiseAbove:<0..1>, Interact:<Tag>. Действия: PlayDialogue, PlayCinematic, SetWeather,
 * SetMusic, TitleCard, ForceWorm, CrowdRitual, Hint, FadeOut, EndDemo, Ellipsis. Каждый бит срабатывает один раз.
 *
 * Ellipsis — «склейка» золотого пути (docs/design/demo_flow.md §5, docs/ui/ui_design.md §12):
 *   Param = <ТегЦели>[,<FadeSec>[,<AdvanceHours>]][,window=<сек>][,pull=<BeatID>@<сек>]...[|<RU титр>|<EN титр>]
 *   Предлагается, пока игрок на золотом пути (идёт к цели, позади неё, тихо, без угрозы червя, не в кат-сцене);
 *   иначе за window секунд отклоняется — свободная игра. Выполнение: затемнение → перенос игрока и группы →
 *   время суток +AdvanceHours → титр-«склейка» поверх чёрного → возврат картинки. Beat:<ID> срабатывает,
 *   только если склейка состоялась (в момент возврата картинки). Отключение: консоль Rakis.Story.Ellipsis 0.
 * Если таблицы нет — встроенные биты по docs/01_scenario.md (блокаут играется от начала до конца).
 *
 * Для других ролей:
 *  - Interact:<Tag> срабатывает автоматически по URakisInteractionComponent::OnInteracted (все теги актора);
 *    ARakisStoryDirector::Find(this)->NotifyInteract(Tag) — ручной вызов (Blueprint, нестандартные объекты);
 *  - консоль: Rakis.Story.Fire <Trigger> (напр. "ZoneEnter:B5_Hall"), Rakis.Story.List.
 */
UCLASS()
class RAKIS_API ARakisStoryDirector : public AActor
{
	GENERATED_BODY()

public:
	ARakisStoryDirector();

	/** Директор текущего мира (по тегу Rakis.Story или первый найденный). */
	static ARakisStoryDirector* Find(const UObject* WorldContextObject);

	/** Сообщить о взаимодействии (триггер Interact:<Tag>). */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Story")
	void NotifyInteract(FName Tag);

	/** Запустить все несработавшие биты с данным триггером (напр. "ZoneEnter:A2_Erg"). */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Story")
	void FireTrigger(FName TriggerKey);

	UFUNCTION(BlueprintPure, Category = "Rakis|Story")
	bool HasBeatFired(FName BeatID) const;

	/** Идёт склейка-эллипсис (затемнение/перенос/возврат). */
	UFUNCTION(BlueprintPure, Category = "Rakis|Story")
	bool IsEllipsisInProgress() const { return Ellipsis.Phase != ERakisEllipsisPhase::None && Ellipsis.Phase != ERakisEllipsisPhase::Offer; }

	/** Консольная переменная Rakis.Story.Ellipsis (1 — склейки золотого пути включены). */
	static bool AreEllipsesEnabled();

	/** Лог состояния битов (консоль Rakis.Story.List). */
	void DumpBeats() const;

	/** Если DT_StoryBeats нет — использовать встроенный сценарий. */
	UPROPERTY(EditAnywhere, Category = "Rakis|Story")
	bool bUseBuiltInBeatsIfTableMissing = true;

	/** Удержание титра главы, с. */
	UPROPERTY(EditAnywhere, Category = "Rakis|Story")
	float TitleCardHoldSeconds = 4.f;

	/** Страховка: если кат-сцена не сообщила об окончании, бит завершается через столько секунд. */
	UPROPERTY(EditAnywhere, Category = "Rakis|Story")
	float CinematicSafetyTimeout = 90.f;

	// --- Эллипсис (склейка золотого пути) ---

	/** Сколько секунд склейка ждёт «золотого» момента, прежде чем отказаться (если в Param нет window=). */
	UPROPERTY(EditAnywhere, Category = "Rakis|Story|Ellipsis", meta = (ClampMin = "1.0"))
	float EllipsisOfferWindow = 20.f;

	/** Затемнение по умолчанию, с. */
	UPROPERTY(EditAnywhere, Category = "Rakis|Story|Ellipsis", meta = (ClampMin = "0.1"))
	float EllipsisFadeSeconds = 1.2f;

	/** Удержание чёрного без титра, с. */
	UPROPERTY(EditAnywhere, Category = "Rakis|Story|Ellipsis", meta = (ClampMin = "0.1"))
	float EllipsisBlackHold = 0.6f;

	/** Удержание титра-склейки (плюс 0.5 с появления и 0.6 с угасания), с. */
	UPROPERTY(EditAnywhere, Category = "Rakis|Story|Ellipsis", meta = (ClampMin = "0.5"))
	float EllipsisCardHold = 1.4f;

	/** Игрок должен быть хотя бы настолько позади плоскости цели (по её направлению), см. */
	UPROPERTY(EditAnywhere, Category = "Rakis|Story|Ellipsis")
	float EllipsisMinBehindCm = 1500.f;

	/** Отклонение направления движения игрока от направления на цель, градусы. */
	UPROPERTY(EditAnywhere, Category = "Rakis|Story|Ellipsis", meta = (ClampMin = "5.0", ClampMax = "180.0"))
	float EllipsisMaxHeadingDeg = 55.f;

	/** Минимальная скорость игрока (идёт, а не стоит), см/с. */
	UPROPERTY(EditAnywhere, Category = "Rakis|Story|Ellipsis")
	float EllipsisMinSpeed = 60.f;

	/** Спутники ближе этого к игроку (или следующие за ним) переносятся вместе с ним, см. */
	UPROPERTY(EditAnywhere, Category = "Rakis|Story|Ellipsis")
	float EllipsisGroupRadius = 8000.f;

	/** Шаг цепочки спутников за игроком после переноса, см (3–4 м). */
	UPROPERTY(EditAnywhere, Category = "Rakis|Story|Ellipsis", meta = (ClampMin = "100.0"))
	float EllipsisCompanionSpacing = 350.f;

	UPROPERTY(BlueprintAssignable, Category = "Rakis|Story")
	FRakisOnTitleCard OnTitleCard;

	UPROPERTY(BlueprintAssignable, Category = "Rakis|Story")
	FRakisOnHint OnHint;

	UPROPERTY(BlueprintAssignable, Category = "Rakis|Story")
	FRakisOnStoryBeat OnBeatFired;

	UPROPERTY(BlueprintAssignable, Category = "Rakis|Story")
	FRakisOnStoryBeat OnBeatCompleted;

protected:
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;

private:
	// --- Делегаты других систем ---
	UFUNCTION() void HandleZoneChanged(ERakisZone OldZone, ERakisZone NewZone);
	UFUNCTION() void HandleWormStateChanged(ERakisWormState OldState, ERakisWormState NewState);
	UFUNCTION() void HandleDialogueChainFinished(FName FirstDialogueID);
	UFUNCTION() void HandleCinematicFinished();
	UFUNCTION() void HandleInteracted(AActor* Actor);

	void LoadBeats();
	void BuildBuiltInBeats();
	void BindSystems();
	void TryBindWorm();
	void TryBindInteraction();
	void PollNoise();
	void FireStart();

	/** OverrideDelay >= 0 — вместо Row.Delay. */
	void ScheduleBeat(int32 Index, float OverrideDelay = -1.f);
	void ExecuteBeat(int32 Index);
	void CompleteBeat(int32 Index);

	// Действия
	void ActionPlayDialogue(int32 Index);
	void ActionPlayCinematic(int32 Index);
	void ActionSetWeather(const FString& Param);
	void ActionSetMusic(const FString& Param);
	void ActionForceWorm(const FString& Param);
	void ActionCrowdRitual();
	void ActionFadeOut(int32 Index);
	void ActionEndDemo();
	void ActionEllipsis(int32 Index);

	// Эллипсис
	bool ParseEllipsisParam(const FString& Param, FRakisEllipsisState& OutState) const;
	AActor* FindTaggedActor(FName Tag) const;
	bool CheckEllipsisOffer(FString& OutReason) const;
	void PollEllipsisOffer();
	void BeginEllipsisCut();
	void PerformEllipsisCut();
	void BeginEllipsisFadeIn();
	void EndEllipsis();
	void DeclineEllipsis(const FString& Reason);
	void AbortEllipsisAfterFade(const FString& Reason);
	void TeleportGroup(const FVector& OldPlayerLocation, const FVector& NewPlayerLocation, const FRotator& Rotation) const;
	void ConsumeSkippedZones(ERakisZone FromZone, ERakisZone ToZone);
	void ApplyEllipsisPulls();
	void SetPlayerInputLocked(bool bLocked) const;
	ERakisZone GetPlayerZone() const;
	void ResetEllipsis();

	void FinishCinematic();
	ARakisCinematicTrigger* FindCinematicTrigger(const FString& Param) const;
	void SetHUDCinematicMode(bool bEnable);

	TArray<FRakisRuntimeBeat> Beats;

	/** Первая реплика цепочки → биты, ждущие её окончания. */
	TMap<FName, TArray<int32>> PendingDialogueBeats;

	int32 CinematicBeatIndex = INDEX_NONE;
	TWeakObjectPtr<ARakisCinematicTrigger> ActiveTrigger;

	TWeakObjectPtr<ARakisWorm> BoundWorm;
	TWeakObjectPtr<URakisInteractionComponent> BoundInteraction;
	bool bRitualStarted = false;
	bool bStarted = false;

	FTimerHandle StartTimer;
	FTimerHandle BindTimer;
	FTimerHandle NoisePollTimer;
	FTimerHandle CinematicSafetyTimer;

	FRakisEllipsisState Ellipsis;
	FTimerHandle EllipsisTimer;
};
