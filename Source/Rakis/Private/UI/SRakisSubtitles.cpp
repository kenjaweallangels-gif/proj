#include "UI/SRakisSubtitles.h"

#include "UI/RakisUIStyle.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/Text/STextBlock.h"

namespace RakisSubtitlesPrivate
{
	static constexpr float FadeIn = 0.2f;
	static constexpr float FadeOut = 0.35f;
	static constexpr float MaxWidthFraction = 0.6f;
}

float SRakisSubtitles::LineFontSize(ERakisSubtitleSize InSize)
{
	switch (InSize)
	{
	case ERakisSubtitleSize::S: return 20.f;
	case ERakisSubtitleSize::L: return 34.f;
	default: return 26.f;
	}
}

float SRakisSubtitles::SpeakerFontSize(ERakisSubtitleSize InSize)
{
	switch (InSize)
	{
	case ERakisSubtitleSize::S: return 13.f;
	case ERakisSubtitleSize::L: return 21.f;
	default: return 16.f;
	}
}

void SRakisSubtitles::Construct(const FArguments& InArgs)
{
	SetVisibility(EVisibility::HitTestInvisible);

	ChildSlot
	.HAlign(HAlign_Center)
	.VAlign(VAlign_Bottom)
	[
		SAssignNew(Plate, SBorder)
		.BorderImage(FRakisUIStyle::WhiteBrush())
		.BorderBackgroundColor(FLinearColor::Transparent)
		.Padding(FMargin(18.f, 8.f))
		.HAlign(HAlign_Center)
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot()
			.AutoHeight()
			.HAlign(HAlign_Center)
			.Padding(0.f, 0.f, 0.f, 4.f)
			[
				SAssignNew(SpeakerText, STextBlock)
				.ColorAndOpacity(FRakisUIStyle::Ochre())
				.ShadowOffset(FVector2D(1.0, 1.5))
				.ShadowColorAndOpacity(FRakisUIStyle::WithAlpha(FRakisUIStyle::Ink(), 0.75f))
				.Justification(ETextJustify::Center)
			]
			+ SVerticalBox::Slot()
			.AutoHeight()
			.HAlign(HAlign_Center)
			[
				SAssignNew(LineText, STextBlock)
				.ColorAndOpacity(FRakisUIStyle::WarmWhite())
				.ShadowOffset(FVector2D(1.0, 1.5))
				.ShadowColorAndOpacity(FRakisUIStyle::WithAlpha(FRakisUIStyle::Ink(), 0.75f))
				.Justification(ETextJustify::Center)
				.AutoWrapText(false)
				.WrapTextAt(1152.f)
			]
		]
	];

	ApplyFonts();
	SetRenderOpacity(0.f);
}

void SRakisSubtitles::ApplyFonts()
{
	if (SpeakerText.IsValid())
	{
		SpeakerText->SetFont(FRakisUIStyle::GetFont(ERakisFontRole::Caps, SpeakerFontSize(Size), 180, true));
	}
	if (LineText.IsValid())
	{
		LineText->SetFont(FRakisUIStyle::GetFont(ERakisFontRole::Body, LineFontSize(Size), 0, true));
	}
}

void SRakisSubtitles::ShowLine(const FText& Speaker, const FText& Line, float Duration)
{
	if (Line.IsEmpty())
	{
		Clear();
		return;
	}
	if (SpeakerText.IsValid())
	{
		// Имитация капители: верхний регистр + меньший кегль + разрядка.
		SpeakerText->SetText(Speaker.ToUpper());
		SpeakerText->SetVisibility(Speaker.IsEmpty() ? EVisibility::Collapsed : EVisibility::HitTestInvisible);
	}
	if (LineText.IsValid())
	{
		LineText->SetText(Line);
	}
	Remaining = FMath::Max(Duration, 0.5f);
}

void SRakisSubtitles::Clear()
{
	Remaining = 0.f;
}

void SRakisSubtitles::SetSizePreset(ERakisSubtitleSize InSize)
{
	Size = InSize;
	ApplyFonts();
}

void SRakisSubtitles::SetBackgroundPlate(bool bEnabled)
{
	bPlate = bEnabled;
	if (Plate.IsValid())
	{
		Plate->SetBorderBackgroundColor(bPlate ? FRakisUIStyle::WithAlpha(FRakisUIStyle::Ink(), 0.45f) : FLinearColor::Transparent);
	}
}

void SRakisSubtitles::SetScreenWidth(float InScreenWidth)
{
	ScreenWidth = FMath::Max(InScreenWidth, 320.f);
}

void SRakisSubtitles::Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime)
{
	using namespace RakisSubtitlesPrivate;
	const float Dt = FMath::Min(InDeltaTime, 0.1f);

	const float Wrap = ScreenWidth * MaxWidthFraction - 36.f;
	if (LineText.IsValid() && !FMath::IsNearlyEqual(Wrap, AppliedWrap, 1.f))
	{
		AppliedWrap = Wrap;
		LineText->SetWrapTextAt(Wrap);
	}

	if (!bFrozen)
	{
		Remaining = FMath::Max(0.f, Remaining - Dt);
	}
	Opacity = FRakisUIStyle::StepFade(Opacity, Remaining > 0.f ? 1.f : 0.f, Dt, FadeIn, FadeOut);
	SetRenderOpacity(FRakisUIStyle::EaseOut(Opacity));
}
