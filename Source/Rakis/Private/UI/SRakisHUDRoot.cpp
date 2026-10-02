#include "UI/SRakisHUDRoot.h"

#include "UI/RakisUIStyle.h"
#include "UI/SRakisBarkLayer.h"
#include "UI/SRakisHint.h"
#include "UI/SRakisInteractPrompt.h"
#include "UI/SRakisMoistureDrop.h"
#include "UI/SRakisNoiseRipple.h"
#include "UI/SRakisPhotoMode.h"
#include "UI/SRakisRhythmTicks.h"
#include "UI/SRakisScreenFX.h"
#include "UI/SRakisSubtitles.h"
#include "UI/SRakisTitleCard.h"
#include "Widgets/Layout/SSpacer.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/SOverlay.h"

void SRakisHUDRoot::Construct(const FArguments& InArgs)
{
	SetVisibility(EVisibility::SelfHitTestInvisible);

	ChildSlot
	[
		SNew(SOverlay)
		.Visibility(EVisibility::SelfHitTestInvisible)

		// ---------------- HUD (скрывается целиком в фоторежиме) ----------------
		+ SOverlay::Slot()
		[
			SAssignNew(HudLayers, SOverlay)
			.Visibility(EVisibility::SelfHitTestInvisible)

			// Игровой слой: рябь + засечки (низ, центр), капля (низ, справа).
			+ SOverlay::Slot()
			[
				SAssignNew(GameplayLayer, SOverlay)
				.Visibility(EVisibility::HitTestInvisible)
				+ SOverlay::Slot()
				.HAlign(HAlign_Center)
				.VAlign(VAlign_Bottom)
				.Padding(FMargin(0.f, 0.f, 0.f, 40.f))
				[
					SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center)
					[
						SAssignNew(Ripple, SRakisNoiseRipple)
					]
					+ SVerticalBox::Slot().AutoHeight()
					[
						SNew(SSpacer).Size(FVector2D(1.0, 12.0))
					]
					+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center)
					[
						SAssignNew(Ticks, SRakisRhythmTicks)
					]
				]
				+ SOverlay::Slot()
				.HAlign(HAlign_Right)
				.VAlign(VAlign_Bottom)
				.Padding(FMargin(0.f, 0.f, 50.f, 50.f))
				[
					SAssignNew(Drop, SRakisMoistureDrop)
				]
			]

			// Подсказка взаимодействия (точка в центре + глагол).
			+ SOverlay::Slot()
			[
				SAssignNew(Prompt, SRakisInteractPrompt)
			]

			// Позиционный лай.
			+ SOverlay::Slot()
			[
				SAssignNew(Barks, SRakisBarkLayer)
			]

			// Леттербокс (под субтитрами — субтитры ложатся на нижнюю полосу).
			+ SOverlay::Slot()
			[
				SAssignNew(Letterbox, SRakisScreenFX)
			]

			// Субтитры: низ, 120 px от края.
			+ SOverlay::Slot()
			.HAlign(HAlign_Fill)
			.VAlign(VAlign_Bottom)
			.Padding(FMargin(0.f, 0.f, 0.f, 120.f))
			[
				SAssignNew(Subtitles, SRakisSubtitles)
			]

			// Подсказка: верх, 96 px.
			+ SOverlay::Slot()
			.HAlign(HAlign_Fill)
			.VAlign(VAlign_Top)
			.Padding(FMargin(0.f, 96.f, 0.f, 0.f))
			[
				SAssignNew(Hint, SRakisHint)
			]

			// Титр главы: нижняя треть (~64 % высоты).
			+ SOverlay::Slot()
			[
				SNew(SVerticalBox)
				.Visibility(EVisibility::HitTestInvisible)
				+ SVerticalBox::Slot().FillHeight(0.60f)
				[
					SNew(SSpacer)
				]
				+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center)
				[
					SAssignNew(TitleCard, SRakisTitleCard)
				]
				+ SVerticalBox::Slot().FillHeight(0.40f)
				[
					SNew(SSpacer)
				]
			]

			// Надпись-лор: центр.
			+ SOverlay::Slot()
			.HAlign(HAlign_Center)
			.VAlign(VAlign_Center)
			[
				SAssignNew(Inscription, SRakisTitleCard)
				.FontRole(ERakisFontRole::Title)
				.FontSize(26.f)
				.LetterSpacing(120)
				.bShowRule(false)
				.FadeIn(0.8f)
				.FadeOut(1.2f)
				.MaxWidth(900.f)
			]
		]

		// ---------------- Над HUD ----------------
		+ SOverlay::Slot()
		[
			SAssignNew(Fade, SRakisScreenFX)
		]
		+ SOverlay::Slot()
		.HAlign(HAlign_Center)
		.VAlign(VAlign_Center)
		[
			SAssignNew(EndCard, SRakisTitleCard)
			.FontRole(ERakisFontRole::Title)
			.FontSize(44.f)
			.LetterSpacing(420)
			.bShowRule(true)
			.FadeIn(1.2f)
			.FadeOut(1.6f)
		]
		+ SOverlay::Slot()
		[
			SAssignNew(PauseMenu, SRakisPauseMenu)
			.OnAction(InArgs._OnMenuAction)
		]
		+ SOverlay::Slot()
		[
			SAssignNew(PhotoMode, SRakisPhotoMode)
			.OnExitRequested(InArgs._OnPhotoExitRequested)
		]
	];
}

void SRakisHUDRoot::Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime)
{
	const float Dt = FMath::Min(InDeltaTime, 0.1f);

	GameplayOpacity = FRakisUIStyle::StepFade(GameplayOpacity, bGameplayVisible ? 1.f : 0.f, Dt, 0.8f, 0.8f);
	HudOpacity = FRakisUIStyle::StepFade(HudOpacity, bHudHidden ? 0.f : 1.f, Dt, 0.2f, 0.15f);

	if (GameplayLayer.IsValid())
	{
		GameplayLayer->SetRenderOpacity(GameplayOpacity);
	}
	if (HudLayers.IsValid())
	{
		HudLayers->SetRenderOpacity(HudOpacity);
	}
	if (Subtitles.IsValid())
	{
		Subtitles->SetScreenWidth(static_cast<float>(AllottedGeometry.GetLocalSize().X));
	}
}
