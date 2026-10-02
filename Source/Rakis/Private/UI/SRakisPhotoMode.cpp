#include "UI/SRakisPhotoMode.h"

#include "UI/RakisPhotoCamera.h"
#include "UI/RakisUIStyle.h"
#include "Framework/Application/SlateApplication.h"
#include "InputCoreTypes.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/Text/STextBlock.h"

namespace RakisPhotoPrivate
{
	static constexpr float MoveSpeed = 300.f;		// см/с
	static constexpr float FastMultiplier = 3.f;
	static constexpr float MouseSensitivity = 0.12f;	// град/пиксель
	static constexpr float StickYawRate = 90.f;		// град/с
	static constexpr float StickPitchRate = 70.f;
	static constexpr float FovRate = 30.f;
	static constexpr float MinFov = 20.f;
	static constexpr float MaxFov = 110.f;
	static constexpr float MinFocus = 30.f;
	static constexpr float MaxFocus = 10000.f;
	static constexpr float MinFStop = 1.2f;
	static constexpr float MaxFStop = 22.f;
	static constexpr float MaxExposure = 3.f;
	static constexpr float MaxRoll = 45.f;
	static constexpr float StickDeadZone = 0.15f;

	static float DeadZone(float Value)
	{
		return FMath::Abs(Value) < StickDeadZone ? 0.f : Value;
	}
}

void SRakisPhotoMode::Construct(const FArguments& InArgs)
{
	OnExitRequested = InArgs._OnExitRequested;

	ChildSlot
	.HAlign(HAlign_Left)
	.VAlign(VAlign_Bottom)
	.Padding(FMargin(32.f, 0.f, 0.f, 32.f))
	[
		SNew(SVerticalBox)
		+ SVerticalBox::Slot()
		.AutoHeight()
		.Padding(0.f, 0.f, 0.f, 6.f)
		[
			SAssignNew(ValuesText, STextBlock)
			.Font(FRakisUIStyle::GetFont(ERakisFontRole::Body, 13.f, 40, true))
			.ColorAndOpacity(FRakisUIStyle::WithAlpha(FRakisUIStyle::WarmWhite(), 0.8f))
			.ShadowOffset(FVector2D(1.0, 1.0))
			.ShadowColorAndOpacity(FRakisUIStyle::WithAlpha(FRakisUIStyle::Ink(), 0.7f))
		]
		+ SVerticalBox::Slot()
		.AutoHeight()
		[
			SAssignNew(LegendText, STextBlock)
			.Font(FRakisUIStyle::GetFont(ERakisFontRole::BodyLight, 13.f, 40, true))
			.ColorAndOpacity(FRakisUIStyle::WithAlpha(FRakisUIStyle::WarmWhite(), 0.6f))
			.ShadowOffset(FVector2D(1.0, 1.0))
			.ShadowColorAndOpacity(FRakisUIStyle::WithAlpha(FRakisUIStyle::Ink(), 0.7f))
			.AutoWrapText(true)
		]
	];

	SetVisibility(EVisibility::Collapsed);
}

void SRakisPhotoMode::Activate(ARakisPhotoCamera* InCamera, const FVector& InStartLocation, const FVector& InAnchor, const FRotator& InRotation, float InFov, const FRakisPhotoModeTexts& InTexts)
{
	Camera = InCamera;
	Anchor = InAnchor;
	Location = InStartLocation;
	// Старт может оказаться дальше 15 м (длинная камера 3-го лица) — подтягиваем в сферу.
	if (FVector::DistSquared(Location, Anchor) > FMath::Square(MaxRadiusCm))
	{
		Location = Anchor + (Location - Anchor).GetSafeNormal() * MaxRadiusCm;
	}
	Pitch = FMath::Clamp(FRotator::NormalizeAxis(InRotation.Pitch), -89.f, 89.f);
	Yaw = InRotation.Yaw;
	StartFov = FMath::Clamp(InFov, RakisPhotoPrivate::MinFov, RakisPhotoPrivate::MaxFov);
	ResetParameters();

	Held = 0;
	LeftX = LeftY = RightX = RightY = LeftTrigger = RightTrigger = 0.f;
	PendingMouseDelta = FVector2f::ZeroVector;
	PendingWheel = 0.f;
	bLegendVisible = true;
	bActive = true;

	SetTexts(InTexts);
	SetVisibility(EVisibility::Visible);
	ApplyToCamera();
}

void SRakisPhotoMode::Deactivate()
{
	bActive = false;
	Camera.Reset();
	Held = 0;
	SetVisibility(EVisibility::Collapsed);
}

void SRakisPhotoMode::SetTexts(const FRakisPhotoModeTexts& InTexts)
{
	Texts = InTexts;
	bLegendGamepad = FRakisUIStyle::IsGamepadActive();
	if (LegendText.IsValid())
	{
		LegendText->SetText(bLegendGamepad ? Texts.LegendGamepad : Texts.LegendKeyboard);
	}
	RefreshValuesText();
}

void SRakisPhotoMode::ResetParameters()
{
	Roll = 0.f;
	Fov = StartFov;
	FocusCm = 0.f;
	FStop = 2.8f;
	ExposureEV = 0.f;
}

uint32 SRakisPhotoMode::KeyToFlag(const FKey& Key) const
{
	// Клавиатура
	if (Key == EKeys::W) return Held_Forward;
	if (Key == EKeys::S) return Held_Back;
	if (Key == EKeys::A) return Held_Left;
	if (Key == EKeys::D) return Held_Right;
	if (Key == EKeys::E) return Held_Up;
	if (Key == EKeys::Q) return Held_Down;
	if (Key == EKeys::LeftShift || Key == EKeys::RightShift) return Held_Fast;
	if (Key == EKeys::Up) return Held_FovIn;
	if (Key == EKeys::Down) return Held_FovOut;
	if (Key == EKeys::R) return Held_FocusFar;
	if (Key == EKeys::F) return Held_FocusNear;
	if (Key == EKeys::T) return Held_ApOpen;
	if (Key == EKeys::G) return Held_ApClose;
	if (Key == EKeys::RightBracket) return Held_ExpUp;
	if (Key == EKeys::LeftBracket) return Held_ExpDown;
	if (Key == EKeys::Z) return Held_RollLeft;
	if (Key == EKeys::C) return Held_RollRight;
	// Геймпад
	if (Key == EKeys::Gamepad_DPad_Up) return Held_FovIn;
	if (Key == EKeys::Gamepad_DPad_Down) return Held_FovOut;
	if (Key == EKeys::Gamepad_DPad_Left) return Held_RollLeft;
	if (Key == EKeys::Gamepad_DPad_Right) return Held_RollRight;
	if (Key == EKeys::Gamepad_RightShoulder) return Held_FocusFar;
	if (Key == EKeys::Gamepad_LeftShoulder) return Held_FocusNear;
	if (Key == EKeys::Gamepad_FaceButton_Top) return Held_ExpUp;
	if (Key == EKeys::Gamepad_FaceButton_Left) return Held_ExpDown;
	if (Key == EKeys::Gamepad_LeftThumbstick) return Held_Fast;
	if (Key == EKeys::Gamepad_FaceButton_Bottom) return Held_Modifier;
	return 0;
}

FReply SRakisPhotoMode::OnKeyDown(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent)
{
	if (!bActive)
	{
		return FReply::Unhandled();
	}
	const FKey Key = InKeyEvent.GetKey();

	// Выход
	if (Key == EKeys::Escape || Key == EKeys::P || Key == EKeys::Gamepad_FaceButton_Right || Key == EKeys::Gamepad_Special_Right)
	{
		OnExitRequested.ExecuteIfBound();
		return FReply::Handled();
	}
	// Скрыть/показать легенду
	if (Key == EKeys::H || Key == EKeys::Gamepad_Special_Left)
	{
		bLegendVisible = !bLegendVisible;
		return FReply::Handled();
	}
	// Сброс параметров
	if (Key == EKeys::BackSpace || Key == EKeys::Gamepad_RightThumbstick)
	{
		ResetParameters();
		return FReply::Handled();
	}

	if (const uint32 Flag = KeyToFlag(Key))
	{
		Held |= Flag;
		return FReply::Handled();
	}
	return FReply::Unhandled();
}

FReply SRakisPhotoMode::OnKeyUp(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent)
{
	if (const uint32 Flag = KeyToFlag(InKeyEvent.GetKey()))
	{
		Held &= ~Flag;
		return FReply::Handled();
	}
	return FReply::Unhandled();
}

FReply SRakisPhotoMode::OnAnalogValueChanged(const FGeometry& MyGeometry, const FAnalogInputEvent& InAnalogInputEvent)
{
	if (!bActive)
	{
		return FReply::Unhandled();
	}
	using namespace RakisPhotoPrivate;
	const FKey Key = InAnalogInputEvent.GetKey();
	const float Value = InAnalogInputEvent.GetAnalogValue();

	if (Key == EKeys::Gamepad_LeftX) { LeftX = DeadZone(Value); return FReply::Handled(); }
	if (Key == EKeys::Gamepad_LeftY) { LeftY = DeadZone(Value); return FReply::Handled(); }
	if (Key == EKeys::Gamepad_RightX) { RightX = DeadZone(Value); return FReply::Handled(); }
	if (Key == EKeys::Gamepad_RightY) { RightY = DeadZone(Value); return FReply::Handled(); }
	if (Key == EKeys::Gamepad_LeftTriggerAxis) { LeftTrigger = DeadZone(Value); return FReply::Handled(); }
	if (Key == EKeys::Gamepad_RightTriggerAxis) { RightTrigger = DeadZone(Value); return FReply::Handled(); }
	return FReply::Unhandled();
}

FReply SRakisPhotoMode::OnMouseButtonDown(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent)
{
	if (!bActive)
	{
		return FReply::Unhandled();
	}
	const FKey Button = MouseEvent.GetEffectingButton();
	if (Button == EKeys::RightMouseButton || Button == EKeys::LeftMouseButton)
	{
		// Обзор мышью с захватом и «сырыми» смещениями.
		return FReply::Handled()
			.CaptureMouse(SharedThis(this))
			.UseHighPrecisionMouseMovement(SharedThis(this))
			.SetUserFocus(SharedThis(this), EFocusCause::Mouse);
	}
	return FReply::Handled().SetUserFocus(SharedThis(this), EFocusCause::Mouse);
}

FReply SRakisPhotoMode::OnMouseButtonUp(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent)
{
	if (HasMouseCapture())
	{
		return FReply::Handled().ReleaseMouseCapture();
	}
	return FReply::Unhandled();
}

FReply SRakisPhotoMode::OnMouseMove(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent)
{
	if (bActive && HasMouseCapture())
	{
		const FVector2D Delta = MouseEvent.GetCursorDelta();
		PendingMouseDelta += FVector2f(static_cast<float>(Delta.X), static_cast<float>(Delta.Y));
		return FReply::Handled();
	}
	return FReply::Unhandled();
}

FReply SRakisPhotoMode::OnMouseWheel(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent)
{
	if (!bActive)
	{
		return FReply::Unhandled();
	}
	PendingWheel += MouseEvent.GetWheelDelta();
	return FReply::Handled();
}

void SRakisPhotoMode::OnFocusLost(const FFocusEvent& InFocusEvent)
{
	SCompoundWidget::OnFocusLost(InFocusEvent);
	// Иначе клавиши «залипают».
	Held = 0;
	LeftX = LeftY = RightX = RightY = LeftTrigger = RightTrigger = 0.f;
}

void SRakisPhotoMode::Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime)
{
	using namespace RakisPhotoPrivate;

	const float TargetOpacity = (bActive && bLegendVisible) ? 1.f : 0.f;
	Opacity = FRakisUIStyle::StepFade(Opacity, TargetOpacity, FMath::Min(InDeltaTime, 0.1f), 0.2f, 0.3f);
	SetRenderOpacity(Opacity);

	if (!bActive || !Camera.IsValid())
	{
		return;
	}
	const float Dt = FMath::Min(InDeltaTime, 0.05f);
	auto Axis = [this](uint32 Positive, uint32 Negative) -> float
	{
		return (IsHeld(Positive) ? 1.f : 0.f) - (IsHeld(Negative) ? 1.f : 0.f);
	};
	const bool bModifier = IsHeld(Held_Modifier);

	// Обзор
	Yaw += PendingMouseDelta.X * MouseSensitivity + RightX * StickYawRate * Dt;
	Pitch = FMath::Clamp(Pitch - PendingMouseDelta.Y * MouseSensitivity + RightY * StickPitchRate * Dt, -89.f, 89.f);
	PendingMouseDelta = FVector2f::ZeroVector;

	// Движение: вперёд/вбок — по взгляду, вверх/вниз — по мировой Z.
	const float Forward = FMath::Clamp(Axis(Held_Forward, Held_Back) + LeftY, -1.f, 1.f);
	const float Right = FMath::Clamp(Axis(Held_Right, Held_Left) + LeftX, -1.f, 1.f);
	const float Up = FMath::Clamp(Axis(Held_Up, Held_Down) + RightTrigger - LeftTrigger, -1.f, 1.f);
	const FRotator ViewRotation(Pitch, Yaw, 0.f);
	const FVector Move = ViewRotation.RotateVector(FVector(Forward, Right, 0.f)) + FVector(0.f, 0.f, Up);
	const float Speed = MoveSpeed * (IsHeld(Held_Fast) ? FastMultiplier : 1.f);
	Location += Move.GetClampedToMaxSize(1.f) * Speed * Dt;

	// Ограничение 15 м от точки входа.
	const FVector Offset = Location - Anchor;
	if (Offset.SizeSquared() > FMath::Square(MaxRadiusCm))
	{
		Location = Anchor + Offset.GetSafeNormal() * MaxRadiusCm;
	}

	// FOV
	Fov = FMath::Clamp(Fov + Axis(Held_FovOut, Held_FovIn) * FovRate * Dt - PendingWheel * 2.f, MinFov, MaxFov);
	PendingWheel = 0.f;

	// Фокус (R/F, RB/LB) и диафрагма (T/G, A + RB/LB)
	const float FocusDir = bModifier ? 0.f : Axis(Held_FocusFar, Held_FocusNear);
	if (FocusDir > 0.f && FocusCm <= 0.f)
	{
		FocusCm = 100.f;
	}
	else if (FocusCm > 0.f && FocusDir != 0.f)
	{
		FocusCm *= FMath::Pow(2.f, FocusDir * Dt);
		FocusCm = FocusCm < MinFocus ? 0.f : FMath::Min(FocusCm, MaxFocus);
	}
	const float ApertureDir = Axis(Held_ApClose, Held_ApOpen) + (bModifier ? Axis(Held_FocusNear, Held_FocusFar) : 0.f);
	FStop = FMath::Clamp(FStop * FMath::Pow(2.f, ApertureDir * 1.2f * Dt), MinFStop, MaxFStop);

	// Экспозиция и крен
	ExposureEV = FMath::Clamp(ExposureEV + Axis(Held_ExpUp, Held_ExpDown) * Dt, -MaxExposure, MaxExposure);
	Roll = FMath::Clamp(Roll + Axis(Held_RollRight, Held_RollLeft) * 30.f * Dt, -MaxRoll, MaxRoll);

	ApplyToCamera();

	// Текст значений — 10 Гц; легенда — по смене устройства.
	TextRefreshTimer -= InDeltaTime;
	if (TextRefreshTimer <= 0.f)
	{
		TextRefreshTimer = 0.1f;
		RefreshValuesText();
	}
	if (FRakisUIStyle::IsGamepadActive() != bLegendGamepad)
	{
		SetTexts(Texts);
	}
}

void SRakisPhotoMode::ApplyToCamera()
{
	if (ARakisPhotoCamera* Cam = Camera.Get())
	{
		Cam->SetActorLocationAndRotation(Location, FRotator(Pitch, Yaw, Roll));
		Cam->ApplySettings(Fov, FocusCm, FStop, ExposureEV);
	}
}

void SRakisPhotoMode::RefreshValuesText()
{
	if (!ValuesText.IsValid())
	{
		return;
	}
	const FString Focus = FocusCm > 0.f
		? FString::Printf(TEXT("%.1f %s"), FocusCm / 100.f, *Texts.Meters.ToString())
		: Texts.FocusOff.ToString();
	const FString Values = FString::Printf(TEXT("FOV %.0f  ·  f/%.1f  ·  %s %s  ·  EV %+.1f  ·  %s %.0f°"),
		Fov, FStop, *Texts.FocusLabel.ToString(), *Focus, ExposureEV, *Texts.RollLabel.ToString(), Roll);
	ValuesText->SetText(FText::FromString(Values));
}
