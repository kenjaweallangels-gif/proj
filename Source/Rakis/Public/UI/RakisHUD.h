#pragma once

#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "Core/RakisTypes.h"
#include "UI/SRakisPauseMenu.h"
#include "RakisHUD.generated.h"

class SRakisHUDRoot;
class SWidget;
class FRakisInputDeviceDetector;
class ARakisCharacter;
class ARakisPlayerController;
class ARakisWorm;
class ARakisStoryDirector;
class ARakisPhotoCamera;
class URakisInteractionComponent;
class URakisDialogueSubsystem;
struct FRakisPhotoModeTexts;

/**
 * HUD «Rakis: Heretics» (контракт §2.2 UI/): чистый Slate, без UMG-ассетов.
 * Создаёт SRakisHUDRoot в вьюпорте, опрашивает игровые значения 30 Гц (шум, ритм, влага, угроза, зона),
 * подписывается на события (диалоги, сюжет, фокус взаимодействия, пауза/фоторежим).
 * Документация: docs/ui/ui_design.md.
 *
 * Публичное API для других ролей:
 *  - SetCinematicMode(bool) — леттербокс 2.35:1 и скрытие игрового HUD (вызывает ARakisCinematicTrigger / StoryDirector);
 *  - FadeToBlack / FadeFromBlack, ShowTitleCard, ShowHint, ShowInscription, ShowEndCard;
 *  - OpenPauseMenu / EnterPhotoMode.
 */
UCLASS()
class RAKIS_API ARakisHUD : public AHUD
{
	GENERATED_BODY()

public:
	ARakisHUD();

	/** HUD первого локального игрока или nullptr. */
	static ARakisHUD* Get(const UObject* WorldContextObject);

	/** Кинорежим: леттербокс, скрыт игровой HUD и подсказка взаимодействия. */
	UFUNCTION(BlueprintCallable, Category = "Rakis|UI")
	void SetCinematicMode(bool bEnable);

	UFUNCTION(BlueprintPure, Category = "Rakis|UI")
	bool IsCinematicMode() const { return bCinematicMode; }

	UFUNCTION(BlueprintCallable, Category = "Rakis|UI")
	void FadeToBlack(float Seconds = 1.f);

	UFUNCTION(BlueprintCallable, Category = "Rakis|UI")
	void FadeFromBlack(float Seconds = 1.f);

	UFUNCTION(BlueprintCallable, Category = "Rakis|UI")
	void ShowTitleCard(const FText& Title, float HoldSeconds = 4.f);

	/** HoldSeconds <= 0 — авто по длине. */
	UFUNCTION(BlueprintCallable, Category = "Rakis|UI")
	void ShowHint(const FText& InHint, float HoldSeconds = 0.f);

	/** Надпись-лор по центру экрана. */
	UFUNCTION(BlueprintCallable, Category = "Rakis|UI")
	void ShowInscription(const FText& InText, float HoldSeconds = 5.f);

	/** Конец демо: в чёрное → «Конец демо / End of demo» → меню «Начать заново · Язык · Субтитры · Выход». */
	UFUNCTION(BlueprintCallable, Category = "Rakis|UI")
	void ShowEndCard();

	UFUNCTION(BlueprintCallable, Category = "Rakis|UI")
	void OpenPauseMenu();

	UFUNCTION(BlueprintCallable, Category = "Rakis|UI")
	void ClosePauseMenu();

	UFUNCTION(BlueprintPure, Category = "Rakis|UI")
	bool IsPauseMenuOpen() const;

	UFUNCTION(BlueprintCallable, Category = "Rakis|UI")
	void EnterPhotoMode();

	UFUNCTION(BlueprintCallable, Category = "Rakis|UI")
	void ExitPhotoMode();

	UFUNCTION(BlueprintPure, Category = "Rakis|UI")
	bool IsPhotoModeActive() const { return bPhotoMode; }

	/** Частота опроса непрерывных значений, Гц. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|UI")
	float PollRateHz = 30.f;

	/** Длительность стартового выхода из чёрного, с. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|UI")
	float StartFadeSeconds = 2.5f;

protected:
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;
	virtual void Tick(float DeltaSeconds) override;

private:
	// --- Делегаты (dynamic, UFUNCTION) ---
	UFUNCTION() void HandlePauseRequested();
	UFUNCTION() void HandlePhotoModeRequested();
	UFUNCTION() void HandleFocusChanged(AActor* Actor, FText Verb);
	UFUNCTION() void HandleSubtitle(FText Speaker, FText Line, float Duration);
	UFUNCTION() void HandleBarkSubtitle(FText Line, float Duration, AActor* Speaker);
	UFUNCTION() void HandleLore(FText LoreText, float Duration);
	UFUNCTION() void HandleTitleCard(FText Title, float Duration);
	UFUNCTION() void HandleHint(FText InHint);
	UFUNCTION() void HandleLanguageChanged(ERakisLanguage NewLanguage);
	UFUNCTION() void HandleSubtitleSettingsChanged();

	// --- Привязки ---
	void BindDialogue();
	void UnbindDialogue();
	void BindPlayerController();
	void BindCharacter(ARakisCharacter* NewCharacter);
	void TryBindStoryDirector();
	ARakisWorm* FindWorm(double Now);

	// --- Логика ---
	void PollGameplay(double Now);
	void UpdateBarkAnchor();
	void UpdateEndSequence(double Now);
	void ApplySubtitleSettings();
	void RefreshMenuTexts();
	void HandleMenuAction(ERakisMenuAction Action, int32 Direction);
	void BuildMenu(TArray<FRakisMenuEntry>& OutEntries, FText& OutCaption, FText& OutLegendKeyboard, FText& OutLegendGamepad) const;
	FRakisPhotoModeTexts BuildPhotoTexts() const;
	float ReadGlobalExposureBias() const;
	bool IsRussian() const;
	void SetUIInputMode(bool bUIOnly, const TSharedPtr<SWidget>& FocusWidget, bool bShowCursor);

	TSharedPtr<SRakisHUDRoot> Root;
	TSharedPtr<SWidget> ViewportWidget;
	TSharedPtr<FRakisInputDeviceDetector> InputDetector;

	TWeakObjectPtr<ARakisPlayerController> BoundController;
	TWeakObjectPtr<ARakisCharacter> BoundCharacter;
	TWeakObjectPtr<URakisInteractionComponent> BoundInteraction;
	TWeakObjectPtr<URakisDialogueSubsystem> BoundDialogue;
	TWeakObjectPtr<ARakisStoryDirector> BoundStory;
	TWeakObjectPtr<ARakisWorm> CachedWorm;
	TWeakObjectPtr<AActor> BarkSpeaker;

	UPROPERTY(Transient)
	TObjectPtr<ARakisPhotoCamera> PhotoCamera;

	double NextPollTime = 0.0;
	double NextWormSearchTime = 0.0;
	double NextStoryBindTime = 0.0;
	double PendingStartFadeAt = -1.0;
	double EndSequenceStart = -1.0;

	FText FocusVerb;
	bool bFocusActive = false;
	bool bCinematicMode = false;
	bool bPhotoMode = false;
	bool bEndDemo = false;
	bool bEndCardShown = false;
	bool bEndMenuOpened = false;
	bool bPausedByMenu = false;
	float SavedTimeDilation = 1.f;
};
