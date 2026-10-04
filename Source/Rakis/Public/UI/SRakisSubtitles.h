#pragma once

#include "CoreMinimal.h"
#include "Widgets/SCompoundWidget.h"
#include "Narrative/RakisDialogueSubsystem.h"

class STextBlock;
class SBorder;

/**
 * Субтитры: низ экрана, ширина ≤ 60 %, имя капителью охрой, строка тёплым белым с мягкой тенью,
 * размеры S/M/L, опциональная тусклая подложка (docs/ui/ui_design.md §5.5).
 */
class RAKIS_API SRakisSubtitles : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SRakisSubtitles) {}
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);

	void ShowLine(const FText& Speaker, const FText& Line, float Duration);
	void Clear();
	void SetSizePreset(ERakisSubtitleSize InSize);
	void SetBackgroundPlate(bool bEnabled);
	/** Ширина экрана в локальных единицах — ограничение 60 % (вызывается корнем HUD). */
	void SetScreenWidth(float InScreenWidth);
	/** Пауза/фоторежим: обратный отсчёт строки замирает (таймер реплики в подсистеме тоже стоит). */
	void SetFrozen(bool bInFrozen) { bFrozen = bInFrozen; }

	virtual void Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime) override;

	static float LineFontSize(ERakisSubtitleSize InSize);
	static float SpeakerFontSize(ERakisSubtitleSize InSize);

private:
	void ApplyFonts();

	TSharedPtr<STextBlock> SpeakerText;
	TSharedPtr<STextBlock> LineText;
	TSharedPtr<SBorder> Plate;

	ERakisSubtitleSize Size = ERakisSubtitleSize::M;
	bool bPlate = false;
	bool bFrozen = false;
	float ScreenWidth = 1920.f;
	float AppliedWrap = -1.f;

	float Opacity = 0.f;
	float Remaining = 0.f;
};
