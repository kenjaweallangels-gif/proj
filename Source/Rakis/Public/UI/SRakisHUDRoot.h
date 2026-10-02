#pragma once

#include "CoreMinimal.h"
#include "Widgets/SCompoundWidget.h"
#include "UI/SRakisPauseMenu.h"

class SOverlay;
class SRakisNoiseRipple;
class SRakisRhythmTicks;
class SRakisMoistureDrop;
class SRakisInteractPrompt;
class SRakisBarkLayer;
class SRakisSubtitles;
class SRakisHint;
class SRakisTitleCard;
class SRakisScreenFX;
class SRakisPhotoMode;

/**
 * Корень HUD (добавляется в вьюпорт ARakisHUD). Слои снизу вверх:
 *   [HUD: игровой слой (рябь, засечки, капля) · подсказка взаимодействия · лай · леттербокс · субтитры · подсказка · титр · надпись]
 *   затемнение · концовка · меню паузы · фоторежим.
 * Сам не опрашивает игру — значения задаёт ARakisHUD (docs/ui/ui_design.md §4, §6).
 */
class RAKIS_API SRakisHUDRoot : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SRakisHUDRoot) {}
		SLATE_EVENT(FRakisOnMenuAction, OnMenuAction)
		SLATE_EVENT(FSimpleDelegate, OnPhotoExitRequested)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);

	/** Игровой слой (рябь/засечки/капля): скрыт в B-зонах, в кинорежиме, при bShowHUD == false. */
	void SetGameplayLayerVisible(bool bVisible) { bGameplayVisible = bVisible; }
	/** Весь HUD (фоторежим). */
	void SetHudHidden(bool bHidden) { bHudHidden = bHidden; }

	virtual void Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime) override;

	// Дочерние виджеты (доступ для ARakisHUD).
	TSharedPtr<SRakisNoiseRipple> Ripple;
	TSharedPtr<SRakisRhythmTicks> Ticks;
	TSharedPtr<SRakisMoistureDrop> Drop;
	TSharedPtr<SRakisInteractPrompt> Prompt;
	TSharedPtr<SRakisBarkLayer> Barks;
	TSharedPtr<SRakisScreenFX> Letterbox;
	TSharedPtr<SRakisSubtitles> Subtitles;
	TSharedPtr<SRakisHint> Hint;
	TSharedPtr<SRakisTitleCard> TitleCard;
	TSharedPtr<SRakisTitleCard> Inscription;
	TSharedPtr<SRakisScreenFX> Fade;
	TSharedPtr<SRakisTitleCard> EndCard;
	TSharedPtr<SRakisPauseMenu> PauseMenu;
	TSharedPtr<SRakisPhotoMode> PhotoMode;

private:
	TSharedPtr<SOverlay> HudLayers;
	TSharedPtr<SOverlay> GameplayLayer;
	bool bGameplayVisible = true;
	bool bHudHidden = false;
	float GameplayOpacity = 1.f;
	float HudOpacity = 1.f;
};
