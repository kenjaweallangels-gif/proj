#include "UI/SRakisPauseMenu.h"

#include "UI/RakisUIStyle.h"
#include "Framework/Application/SlateApplication.h"
#include "InputCoreTypes.h"
#include "Rendering/DrawElements.h"
#include "Widgets/Images/SImage.h"
#include "Widgets/Layout/SBackgroundBlur.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/Layout/SSpacer.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/SOverlay.h"
#include "Widgets/Text/STextBlock.h"

// ---------------------------------------------------------------------------------------------
// Пункт меню: только текст; выбранный — охра + подчёркивание 1.5 px, «вытягивается» за 0.18 с.

class SRakisMenuEntry : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SRakisMenuEntry) {}
		SLATE_ARGUMENT(FText, Label)
		SLATE_EVENT(FSimpleDelegate, OnHovered)
		SLATE_EVENT(FSimpleDelegate, OnClicked)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs)
	{
		OnHovered = InArgs._OnHovered;
		OnClicked = InArgs._OnClicked;
		ChildSlot
		.Padding(FMargin(0.f, 6.f, 0.f, 8.f))
		[
			SAssignNew(Text, STextBlock)
			.Text(InArgs._Label)
			.Font(FRakisUIStyle::GetFont(ERakisFontRole::BodyLight, 30.f, 60, true))
			.ColorAndOpacity(FRakisUIStyle::WarmWhite())
			.ShadowOffset(FVector2D(1.0, 1.5))
			.ShadowColorAndOpacity(FRakisUIStyle::WithAlpha(FRakisUIStyle::Ink(), 0.6f))
		];
	}

	void SetLabel(const FText& InLabel)
	{
		if (Text.IsValid())
		{
			Text->SetText(InLabel);
		}
	}

	void SetSelected(bool bInSelected) { bSelected = bInSelected; }

	virtual void Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime) override
	{
		Underline = FRakisUIStyle::StepFade(Underline, bSelected ? 1.f : 0.f, FMath::Min(InDeltaTime, 0.1f), 0.18f, 0.12f);
		if (Text.IsValid())
		{
			Text->SetColorAndOpacity(FMath::Lerp(FRakisUIStyle::WarmWhite(), FRakisUIStyle::Ochre(), Underline));
		}
	}

	virtual int32 OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
		FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const override
	{
		const int32 MaxLayer = SCompoundWidget::OnPaint(Args, AllottedGeometry, MyCullingRect, OutDrawElements, LayerId, InWidgetStyle, bParentEnabled);
		const float U = FRakisUIStyle::EaseOut(Underline);
		if (U > 0.01f)
		{
			const FVector2D LocalSize = AllottedGeometry.GetLocalSize();
			const float Width = static_cast<float>(LocalSize.X) * U;
			FSlateDrawElement::MakeBox(OutDrawElements, MaxLayer + 1,
				AllottedGeometry.ToPaintGeometry(FVector2f(Width, 1.5f), FSlateLayoutTransform(FVector2f(0.f, static_cast<float>(LocalSize.Y) - 4.f))),
				FRakisUIStyle::WhiteBrush(), ESlateDrawEffect::None,
				FRakisUIStyle::WithAlpha(FRakisUIStyle::Ochre(), InWidgetStyle.GetColorAndOpacityTint().A));
		}
		return MaxLayer + 1;
	}

	virtual void OnMouseEnter(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent) override
	{
		SCompoundWidget::OnMouseEnter(MyGeometry, MouseEvent);
		OnHovered.ExecuteIfBound();
	}

	virtual FReply OnMouseButtonDown(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent) override
	{
		return MouseEvent.GetEffectingButton() == EKeys::LeftMouseButton ? FReply::Handled() : FReply::Unhandled();
	}

	virtual FReply OnMouseButtonUp(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent) override
	{
		if (MouseEvent.GetEffectingButton() == EKeys::LeftMouseButton)
		{
			OnClicked.ExecuteIfBound();
			return FReply::Handled();
		}
		return FReply::Unhandled();
	}

private:
	TSharedPtr<STextBlock> Text;
	FSimpleDelegate OnHovered;
	FSimpleDelegate OnClicked;
	bool bSelected = false;
	float Underline = 0.f;
};

// ---------------------------------------------------------------------------------------------

void SRakisPauseMenu::Construct(const FArguments& InArgs)
{
	OnAction = InArgs._OnAction;

	ChildSlot
	[
		SNew(SOverlay)
		// Размытие кадра + тёплое затемнение.
		+ SOverlay::Slot()
		[
			SNew(SBackgroundBlur)
			.BlurStrength(6.f)
			.Padding(0.f)
			[
				SNew(SImage)
				.Image(FRakisUIStyle::WhiteBrush())
				.ColorAndOpacity(FRakisUIStyle::WithAlpha(FRakisUIStyle::Ink(), 0.55f))
			]
		]
		// Список прижат влево (12 % ширины), по вертикали — центр.
		+ SOverlay::Slot()
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot()
			.FillWidth(0.12f)
			[
				SNew(SSpacer)
			]
			+ SHorizontalBox::Slot()
			.AutoWidth()
			.VAlign(VAlign_Center)
			[
				SNew(SVerticalBox)
				+ SVerticalBox::Slot()
				.AutoHeight()
				.Padding(0.f, 0.f, 0.f, 28.f)
				[
					SAssignNew(CaptionText, STextBlock)
					.Font(FRakisUIStyle::GetFont(ERakisFontRole::Caps, 13.f, 400))
					.ColorAndOpacity(FRakisUIStyle::WithAlpha(FRakisUIStyle::Ochre(), 0.7f))
				]
				+ SVerticalBox::Slot()
				.AutoHeight()
				[
					SAssignNew(List, SVerticalBox)
				]
				+ SVerticalBox::Slot()
				.AutoHeight()
				.Padding(0.f, 36.f, 0.f, 0.f)
				[
					SAssignNew(LegendText, STextBlock)
					.Font(FRakisUIStyle::GetFont(ERakisFontRole::BodyLight, 13.f, 40))
					.ColorAndOpacity(FRakisUIStyle::WithAlpha(FRakisUIStyle::WarmWhite(), 0.5f))
				]
			]
			+ SHorizontalBox::Slot()
			.FillWidth(0.88f)
			[
				SNew(SSpacer)
			]
		]
	];

	SetVisibility(EVisibility::Collapsed);
	SetRenderOpacity(0.f);
}

void SRakisPauseMenu::Open(const FText& Caption, const TArray<FRakisMenuEntry>& InEntries, bool bInAllowBack,
	const FText& LegendKeyboard, const FText& LegendGamepad)
{
	bOpen = true;
	bAllowBack = bInAllowBack;
	Selected = 0;
	Entries = InEntries;
	LegendKeyboardText = LegendKeyboard;
	LegendGamepadText = LegendGamepad;
	if (CaptionText.IsValid())
	{
		CaptionText->SetText(Caption);
	}
	RebuildList();
	ApplyLegend();
	SetVisibility(EVisibility::Visible);
}

void SRakisPauseMenu::UpdateEntries(const FText& Caption, const TArray<FRakisMenuEntry>& InEntries,
	const FText& LegendKeyboard, const FText& LegendGamepad)
{
	LegendKeyboardText = LegendKeyboard;
	LegendGamepadText = LegendGamepad;
	if (CaptionText.IsValid())
	{
		CaptionText->SetText(Caption);
	}
	if (InEntries.Num() != Entries.Num())
	{
		Entries = InEntries;
		Selected = FMath::Clamp(Selected, 0, FMath::Max(0, Entries.Num() - 1));
		RebuildList();
	}
	else
	{
		Entries = InEntries;
		for (int32 Index = 0; Index < Entries.Num(); ++Index)
		{
			if (EntryWidgets.IsValidIndex(Index) && EntryWidgets[Index].IsValid())
			{
				EntryWidgets[Index]->SetLabel(Entries[Index].Label);
			}
		}
	}
	ApplyLegend();
}

void SRakisPauseMenu::Close()
{
	bOpen = false;
	// Видимость переключится в Collapsed, когда угаснет (Tick).
	SetVisibility(EVisibility::HitTestInvisible);
}

void SRakisPauseMenu::RebuildList()
{
	if (!List.IsValid())
	{
		return;
	}
	List->ClearChildren();
	EntryWidgets.Reset();

	const TWeakPtr<SRakisPauseMenu> WeakThis = SharedThis(this);
	for (int32 Index = 0; Index < Entries.Num(); ++Index)
	{
		TSharedPtr<SRakisMenuEntry> Entry;
		List->AddSlot()
		.AutoHeight()
		.HAlign(HAlign_Left)
		[
			SAssignNew(Entry, SRakisMenuEntry)
			.Label(Entries[Index].Label)
			.OnHovered(FSimpleDelegate::CreateLambda([WeakThis, Index]()
			{
				if (const TSharedPtr<SRakisPauseMenu> Menu = WeakThis.Pin())
				{
					Menu->Select(Index);
				}
			}))
			.OnClicked(FSimpleDelegate::CreateLambda([WeakThis, Index]()
			{
				if (const TSharedPtr<SRakisPauseMenu> Menu = WeakThis.Pin())
				{
					Menu->Select(Index);
					Menu->Activate(Index, 0);
				}
			}))
		];
		EntryWidgets.Add(Entry);
	}
	Select(Selected);
}

void SRakisPauseMenu::Select(int32 Index)
{
	if (Entries.Num() == 0)
	{
		return;
	}
	// Циклический выбор.
	Selected = (Index % Entries.Num() + Entries.Num()) % Entries.Num();
	for (int32 I = 0; I < EntryWidgets.Num(); ++I)
	{
		if (EntryWidgets[I].IsValid())
		{
			EntryWidgets[I]->SetSelected(I == Selected);
		}
	}
}

void SRakisPauseMenu::Activate(int32 Index, int32 Direction)
{
	if (!bOpen || !Entries.IsValidIndex(Index))
	{
		return;
	}
	const ERakisMenuAction Action = Entries[Index].Action;
	// ←/→ имеют смысл только для переключателей.
	if (Direction != 0 && Action != ERakisMenuAction::Language && Action != ERakisMenuAction::Subtitles)
	{
		return;
	}
	OnAction.ExecuteIfBound(Action, Direction);
}

void SRakisPauseMenu::ApplyLegend()
{
	bLegendGamepad = FRakisUIStyle::IsGamepadActive();
	if (LegendText.IsValid())
	{
		LegendText->SetText(bLegendGamepad ? LegendGamepadText : LegendKeyboardText);
	}
}

FReply SRakisPauseMenu::OnKeyDown(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent)
{
	if (!bOpen)
	{
		return FReply::Unhandled();
	}
	const FKey Key = InKeyEvent.GetKey();

	if (Key == EKeys::Up || Key == EKeys::W || Key == EKeys::Gamepad_DPad_Up || Key == EKeys::Gamepad_LeftStick_Up)
	{
		Select(Selected - 1);
		return FReply::Handled();
	}
	if (Key == EKeys::Down || Key == EKeys::S || Key == EKeys::Gamepad_DPad_Down || Key == EKeys::Gamepad_LeftStick_Down)
	{
		Select(Selected + 1);
		return FReply::Handled();
	}
	if (Key == EKeys::Left || Key == EKeys::A || Key == EKeys::Gamepad_DPad_Left || Key == EKeys::Gamepad_LeftStick_Left)
	{
		Activate(Selected, -1);
		return FReply::Handled();
	}
	if (Key == EKeys::Right || Key == EKeys::D || Key == EKeys::Gamepad_DPad_Right || Key == EKeys::Gamepad_LeftStick_Right)
	{
		Activate(Selected, +1);
		return FReply::Handled();
	}
	if (Key == EKeys::Enter || Key == EKeys::SpaceBar || Key == EKeys::Gamepad_FaceButton_Bottom || Key == EKeys::Virtual_Accept)
	{
		Activate(Selected, 0);
		return FReply::Handled();
	}
	if (Key == EKeys::Escape || Key == EKeys::Gamepad_FaceButton_Right || Key == EKeys::Gamepad_Special_Right || Key == EKeys::Virtual_Back)
	{
		if (bAllowBack)
		{
			OnAction.ExecuteIfBound(ERakisMenuAction::Resume, 0);
		}
		return FReply::Handled();
	}
	return FReply::Unhandled();
}

FReply SRakisPauseMenu::OnMouseButtonDown(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent)
{
	// Клик мимо пунктов не должен отнимать фокус у меню.
	return FReply::Handled().SetUserFocus(SharedThis(this), EFocusCause::Mouse);
}

void SRakisPauseMenu::Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime)
{
	const float Dt = FMath::Min(InDeltaTime, 0.1f);
	Opacity = FRakisUIStyle::StepFade(Opacity, bOpen ? 1.f : 0.f, Dt, 0.25f, 0.2f);
	SetRenderOpacity(FRakisUIStyle::EaseOut(Opacity));
	if (!bOpen && Opacity <= 0.f && GetVisibility() != EVisibility::Collapsed)
	{
		SetVisibility(EVisibility::Collapsed);
	}
	if (bOpen && FRakisUIStyle::IsGamepadActive() != bLegendGamepad)
	{
		ApplyLegend();
	}
}
