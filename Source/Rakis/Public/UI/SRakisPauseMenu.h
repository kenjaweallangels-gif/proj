#pragma once

#include "CoreMinimal.h"
#include "Widgets/SCompoundWidget.h"

class STextBlock;
class SVerticalBox;
class SRakisMenuEntry;

/** Действие пункта меню паузы. */
enum class ERakisMenuAction : uint8
{
	Resume,
	PhotoMode,
	Language,
	Subtitles,
	Quit,
	Restart
};

struct FRakisMenuEntry
{
	ERakisMenuAction Action = ERakisMenuAction::Resume;
	FText Label;
};

/** Direction: 0 — выбрать (Enter/A/клик), −1/+1 — переключить значение (←/→). */
DECLARE_DELEGATE_TwoParams(FRakisOnMenuAction, ERakisMenuAction /*Action*/, int32 /*Direction*/);

/**
 * Меню паузы: размытый кадр + затемнение, вертикальный текстовый список,
 * выбранный пункт — охра с подчёркиванием. Клавиатура, геймпад, мышь (docs/ui/ui_design.md §5.10).
 * Логику действий выполняет ARakisHUD через OnAction.
 */
class RAKIS_API SRakisPauseMenu : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SRakisPauseMenu) {}
		SLATE_EVENT(FRakisOnMenuAction, OnAction)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);

	/** Открыть с набором пунктов. bAllowBack = false в режиме «конец демо». */
	void Open(const FText& Caption, const TArray<FRakisMenuEntry>& InEntries, bool bInAllowBack,
		const FText& LegendKeyboard, const FText& LegendGamepad);
	/** Обновить подписи (смена языка/значения), не сбрасывая выбор. */
	void UpdateEntries(const FText& Caption, const TArray<FRakisMenuEntry>& InEntries,
		const FText& LegendKeyboard, const FText& LegendGamepad);
	void Close();
	bool IsOpen() const { return bOpen; }

	virtual bool SupportsKeyboardFocus() const override { return true; }
	virtual FReply OnKeyDown(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent) override;
	virtual FReply OnMouseButtonDown(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent) override;
	virtual void Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime) override;

private:
	void RebuildList();
	void Select(int32 Index);
	void Activate(int32 Index, int32 Direction);
	void ApplyLegend();

	FRakisOnMenuAction OnAction;

	TSharedPtr<SVerticalBox> List;
	TSharedPtr<STextBlock> CaptionText;
	TSharedPtr<STextBlock> LegendText;
	TArray<TSharedPtr<SRakisMenuEntry>> EntryWidgets;
	TArray<FRakisMenuEntry> Entries;

	FText LegendKeyboardText;
	FText LegendGamepadText;
	bool bLegendGamepad = false;

	int32 Selected = 0;
	bool bOpen = false;
	bool bAllowBack = true;
	float Opacity = 0.f;
};
