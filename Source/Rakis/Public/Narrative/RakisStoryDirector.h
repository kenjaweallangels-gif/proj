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
 * SetMusic, TitleCard, ForceWorm, CrowdRitual, Hint, FadeOut, EndDemo. Каждый бит срабатывает один раз.
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

	void ScheduleBeat(int32 Index);
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
};
