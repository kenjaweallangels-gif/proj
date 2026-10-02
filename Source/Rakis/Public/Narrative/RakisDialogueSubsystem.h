#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "TimerManager.h"
#include "Core/RakisTypes.h"
#include "Core/RakisDataTypes.h"
#include "RakisDialogueSubsystem.generated.h"

class UDataTable;
class UAudioComponent;
class USoundBase;
class AActor;

/** Размер субтитров (доступность, docs/ui/ui_design.md §3, §8). */
UENUM(BlueprintType)
enum class ERakisSubtitleSize : uint8
{
	S,
	M,
	L
};

/** Сюжетная реплика: имя говорящего (уже локализованное, может быть пустым), строка, длительность показа. */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_ThreeParams(FRakisOnSubtitle, FText, Speaker, FText, Line, float, Duration);
/** Реплика завершилась (по таймеру), DialogueID — её строка в DT_Dialogue_S1. */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FRakisOnLineFinished, FName, DialogueID);
/** Завершилась вся цепочка NextID, начатая PlayLine(FirstDialogueID). */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FRakisOnDialogueChainFinished, FName, FirstDialogueID);
/** Лай толпы, показываемый маленьким позиционным субтитром (только если говорящий ближе 8 м). */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_ThreeParams(FRakisOnBarkSubtitle, FText, Line, float, Duration, AActor*, Speaker);
/** Надпись-лор (Speaker = "Lore" или ShowLore): центрированная «инскрипция». */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FRakisOnLore, FText, Text, float, Duration);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FRakisOnLanguageChanged, ERakisLanguage, NewLanguage);
DECLARE_DYNAMIC_MULTICAST_DELEGATE(FRakisOnSubtitleSettingsChanged);

/**
 * Диалоги и лай (контракт §2.2 Narrative/).
 * - PlayLine: очередь цепочек (реплики не перекрываются), NextID, Condition (флаг или живое состояние, IsConditionMet;
 *   первая реплика запрошенной цепочки играет всегда, следующие по NextID — только при выполненном условии),
 *   VO 2D или прикреплённое к зарегистрированному актору говорящего.
 * - PlayBark: кулдаун строки + глобальный ограничитель (1 лай / 3 с; 1 лай-субтитр во время сюжетной реплики).
 * - ShowLore: надпись по LoreID (строка DT_Dialogue с Speaker = "Lore"); вызывает ARakisInspectable.
 * - Язык RU/EN (консоль: Rakis.Lang RU|EN), настройки субтитров — в GameUserSettings.ini [Rakis.UI].
 * Если DT_Dialogue_S1 нет — используется встроенный набор реплик сцены (см. .cpp), чтобы блокаут игрался.
 */
UCLASS()
class RAKIS_API URakisDialogueSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	/** Удобный доступ из любого актора/компонента. Может вернуть nullptr. */
	static URakisDialogueSubsystem* Get(const UObject* WorldContextObject);

	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

	// --- Сюжетные реплики ---
	UFUNCTION(BlueprintCallable, Category = "Rakis|Dialogue")
	void PlayLine(FName DialogueID);

	/** Останавливает текущую реплику, VO и очищает очередь (смена уровня, рестарт). */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Dialogue")
	void StopAll();

	UFUNCTION(BlueprintPure, Category = "Rakis|Dialogue")
	bool IsStoryLinePlaying() const { return bLinePlaying; }

	// --- Лай ---
	UFUNCTION(BlueprintCallable, Category = "Rakis|Dialogue")
	void PlayBark(FName Archetype, FName Context, AActor* Speaker);

	// --- Лор (вызывать из ARakisInspectable::Interact) ---
	UFUNCTION(BlueprintCallable, Category = "Rakis|Dialogue")
	void ShowLore(FName LoreID);

	// --- Говорящие ---
	/** Привязать VO говорящего (Kair, Ilva, Rayn, Ossana, Rider1, Rider2, Guard, Harmat, Priestess) к актору. */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Dialogue")
	void RegisterSpeaker(FName SpeakerID, AActor* Actor);

	UFUNCTION(BlueprintCallable, Category = "Rakis|Dialogue")
	void UnregisterSpeaker(FName SpeakerID);

	UFUNCTION(BlueprintPure, Category = "Rakis|Dialogue")
	FText GetSpeakerDisplayName(FName SpeakerID) const;

	// --- Условия реплик (Condition = имя флага, напр. "Beat:B2_Enter" или "WormState:Surface") ---
	UFUNCTION(BlueprintCallable, Category = "Rakis|Dialogue")
	void SetFlag(FName Flag, bool bSet = true);

	UFUNCTION(BlueprintPure, Category = "Rakis|Dialogue")
	bool HasFlag(FName Flag) const { return Flags.Contains(Flag); }

	/**
	 * Условие реплики (docs/design/mechanics.md §5.3): флаг (Beat:/Interact:/WormState:) или живое состояние —
	 * ZoneEnter:<Zone>, WormState:<State>, NoiseAbove:<x>, SandWalk:Regular|Irregular, Surface:<ERakisSurface>, MoistureBelow:<x>.
	 * Пустое — всегда истинно. Для реакций спутников: проверить перед PlayLine.
	 */
	UFUNCTION(BlueprintPure, Category = "Rakis|Dialogue")
	bool IsConditionMet(FName Condition) const;

	// --- Язык ---
	UFUNCTION(BlueprintCallable, Category = "Rakis|Dialogue")
	void SetLanguage(ERakisLanguage NewLanguage);

	UFUNCTION(BlueprintPure, Category = "Rakis|Dialogue")
	ERakisLanguage GetLanguage() const { return Language; }

	/** Выбор строки по текущему языку (пустая EN → RU и наоборот). */
	FText PickText(const FString& RU, const FString& EN) const;
	/** Разбирает "RU-текст|EN-текст" (формат Param в DT_StoryBeats). */
	FText PickPipeText(const FString& Pipe) const;

	// --- Настройки субтитров ---
	UFUNCTION(BlueprintCallable, Category = "Rakis|Dialogue")
	void SetSubtitleSize(ERakisSubtitleSize NewSize);

	UFUNCTION(BlueprintPure, Category = "Rakis|Dialogue")
	ERakisSubtitleSize GetSubtitleSize() const { return SubtitleSize; }

	UFUNCTION(BlueprintCallable, Category = "Rakis|Dialogue")
	void SetSubtitleBackground(bool bEnabled);

	UFUNCTION(BlueprintPure, Category = "Rakis|Dialogue")
	bool GetSubtitleBackground() const { return bSubtitleBackground; }

	/** Авто-длительность: clamp(0.06 с/символ + 1.2, 2.2, 7). */
	static float ComputeAutoDuration(const FString& Line);

	// --- События ---
	UPROPERTY(BlueprintAssignable, Category = "Rakis|Dialogue")
	FRakisOnSubtitle OnSubtitle;

	UPROPERTY(BlueprintAssignable, Category = "Rakis|Dialogue")
	FRakisOnLineFinished OnLineFinished;

	UPROPERTY(BlueprintAssignable, Category = "Rakis|Dialogue")
	FRakisOnDialogueChainFinished OnChainFinished;

	UPROPERTY(BlueprintAssignable, Category = "Rakis|Dialogue")
	FRakisOnBarkSubtitle OnBarkSubtitle;

	UPROPERTY(BlueprintAssignable, Category = "Rakis|Dialogue")
	FRakisOnLore OnLore;

	UPROPERTY(BlueprintAssignable, Category = "Rakis|Dialogue")
	FRakisOnLanguageChanged OnLanguageChanged;

	UPROPERTY(BlueprintAssignable, Category = "Rakis|Dialogue")
	FRakisOnSubtitleSettingsChanged OnSubtitleSettingsChanged;

	/** Порог дистанции позиционного лай-субтитра, см. */
	static constexpr float BarkSubtitleRadius = 800.f;
	/** Глобальный ограничитель лая, с. */
	static constexpr float BarkGlobalInterval = 3.f;

private:
	/** Подписка на ARakisInspectable::OnInspected. */
	FDelegateHandle InspectHandle;

	void LoadTables();
	void BuildFallbackDialogue();
	void LoadSettings();
	void SaveSettings() const;

	const FRakisDialogueRow* FindDialogueRow(FName DialogueID) const;
	void StartChain(FName FirstID);
	/** bIgnoreCondition — первая реплика цепочки, запрошенной PlayLine. */
	void StartLine(FName DialogueID, bool bIgnoreCondition = false);
	void HandleLineTimer();
	void FinishChain();
	void StartNextQueued();

	UAudioComponent* PlayVO(const FString& VOPath, AActor* AttachTo, float& OutSoundDuration);
	void StopCurrentVO();
	UWorld* GetGameWorld() const;
	AActor* FindSpeakerActor(FName SpeakerID) const;

	UPROPERTY(Transient)
	TObjectPtr<UDataTable> DialogueTable;

	UPROPERTY(Transient)
	TObjectPtr<UDataTable> BarksTable;

	/** Встроенные реплики сцены (fallback, docs/01_scenario.md). */
	TMap<FName, FRakisDialogueRow> FallbackDialogue;

	/** Очередь начал цепочек, ожидающих своей очереди. */
	TArray<FName> ChainQueue;
	FName CurrentChainStart = NAME_None;
	FName CurrentLineID = NAME_None;
	bool bLinePlaying = false;
	FTimerHandle LineTimer;
	TWeakObjectPtr<UAudioComponent> CurrentVO;

	TMap<FName, TWeakObjectPtr<AActor>> Speakers;
	TSet<FName> Flags;

	/** Кулдауны лая: имя строки → время последнего проигрывания (FPlatformTime::Seconds). */
	TMap<FName, double> BarkLastPlayed;
	double LastBarkTime = -1000.0;
	double BarkSubtitleUntil = -1000.0;

	ERakisLanguage Language = ERakisLanguage::EN;
	ERakisSubtitleSize SubtitleSize = ERakisSubtitleSize::M;
	bool bSubtitleBackground = false;

	mutable bool bWarnedNoDialogueTable = false;
	mutable bool bWarnedNoBarksTable = false;
	mutable TSet<FName> WarnedMissingLines;
};
