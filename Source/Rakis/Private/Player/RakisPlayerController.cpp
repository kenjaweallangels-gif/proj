#include "Player/RakisPlayerController.h"

#include "Camera/CameraShakeBase.h"
#include "Camera/PlayerCameraManager.h"
#include "EnhancedInputComponent.h"
#include "EnhancedInputSubsystems.h"
#include "Engine/LocalPlayer.h"
#include "InputAction.h"
#include "InputCoreTypes.h"
#include "InputMappingContext.h"
#include "InputModifiers.h"
#include "Player/RakisWormCameraShake.h"
#include "Rakis.h"

namespace RakisInput
{
	static UInputAction* MakeAction(UObject* Outer, const TCHAR* Name, EInputActionValueType Type, bool bWhenPaused = false)
	{
		UInputAction* Action = NewObject<UInputAction>(Outer, FName(Name), RF_Transient);
		Action->ValueType = Type;
		Action->bTriggerWhenPaused = bWhenPaused;
		return Action;
	}

	static UInputModifierNegate* Negate(UObject* Outer, bool bX, bool bY)
	{
		UInputModifierNegate* Mod = NewObject<UInputModifierNegate>(Outer);
		Mod->bX = bX;
		Mod->bY = bY;
		Mod->bZ = false;
		return Mod;
	}

	static UInputModifierSwizzleAxis* SwizzleYXZ(UObject* Outer)
	{
		UInputModifierSwizzleAxis* Mod = NewObject<UInputModifierSwizzleAxis>(Outer);
		Mod->Order = EInputAxisSwizzle::YXZ;
		return Mod;
	}

	static UInputModifierDeadZone* DeadZone(UObject* Outer, float Lower)
	{
		UInputModifierDeadZone* Mod = NewObject<UInputModifierDeadZone>(Outer);
		Mod->LowerThreshold = Lower;
		Mod->UpperThreshold = 1.f;
		Mod->Type = EDeadZoneType::Radial;
		return Mod;
	}

	static UInputModifierScalar* Scalar(UObject* Outer, const FVector& Scale)
	{
		UInputModifierScalar* Mod = NewObject<UInputModifierScalar>(Outer);
		Mod->Scalar = Scale;
		return Mod;
	}
}

ARakisPlayerController::ARakisPlayerController()
{
	WormShakeClass = URakisWormCameraShake::StaticClass();
}

const FRakisInputActions& ARakisPlayerController::GetInputActions()
{
	BuildInputObjects();
	return Actions;
}

UInputMappingContext* ARakisPlayerController::GetMappingContext()
{
	BuildInputObjects();
	return MappingContext;
}

void ARakisPlayerController::BuildInputObjects()
{
	if (bInputBuilt)
	{
		return;
	}
	bInputBuilt = true;

	using namespace RakisInput;

	Actions.Move = MakeAction(this, TEXT("IA_Rakis_Move"), EInputActionValueType::Axis2D);
	Actions.Look = MakeAction(this, TEXT("IA_Rakis_Look"), EInputActionValueType::Axis2D);
	Actions.Sprint = MakeAction(this, TEXT("IA_Rakis_Sprint"), EInputActionValueType::Boolean);
	Actions.SandWalk = MakeAction(this, TEXT("IA_Rakis_SandWalk"), EInputActionValueType::Boolean);
	Actions.Stutter = MakeAction(this, TEXT("IA_Rakis_Stutter"), EInputActionValueType::Boolean);
	Actions.Interact = MakeAction(this, TEXT("IA_Rakis_Interact"), EInputActionValueType::Boolean);
	Actions.ToggleCamera = MakeAction(this, TEXT("IA_Rakis_ToggleCamera"), EInputActionValueType::Boolean);
	Actions.Thumper = MakeAction(this, TEXT("IA_Rakis_Thumper"), EInputActionValueType::Boolean);
	Actions.Pause = MakeAction(this, TEXT("IA_Rakis_Pause"), EInputActionValueType::Boolean, true);
	Actions.PhotoMode = MakeAction(this, TEXT("IA_Rakis_PhotoMode"), EInputActionValueType::Boolean, true);

	MappingContext = NewObject<UInputMappingContext>(this, TEXT("IMC_Rakis_Default"), RF_Transient);
	UInputMappingContext* IMC = MappingContext;

	// --- Движение: WASD (W/S — ось Y через Swizzle), левый стик ---
	{
		FEnhancedActionKeyMapping& W = IMC->MapKey(Actions.Move, EKeys::W);
		W.Modifiers.Add(SwizzleYXZ(IMC));

		FEnhancedActionKeyMapping& S = IMC->MapKey(Actions.Move, EKeys::S);
		S.Modifiers.Add(SwizzleYXZ(IMC));
		S.Modifiers.Add(Negate(IMC, true, true));

		FEnhancedActionKeyMapping& A = IMC->MapKey(Actions.Move, EKeys::A);
		A.Modifiers.Add(Negate(IMC, true, false));

		IMC->MapKey(Actions.Move, EKeys::D);

		FEnhancedActionKeyMapping& Stick = IMC->MapKey(Actions.Move, EKeys::Gamepad_Left2D);
		Stick.Modifiers.Add(DeadZone(IMC, GamepadDeadZone));
	}

	// --- Обзор: на выходе градусы (персонаж сам ставит ControlRotation, без легаси-масштабов PC) ---
	{
		const float YSign = bInvertLookY ? -1.f : 1.f;

		FEnhancedActionKeyMapping& Mouse = IMC->MapKey(Actions.Look, EKeys::Mouse2D);
		Mouse.Modifiers.Add(Scalar(IMC, FVector(MouseLookScale, MouseLookScale * YSign, 1.f)));

		FEnhancedActionKeyMapping& Stick = IMC->MapKey(Actions.Look, EKeys::Gamepad_Right2D);
		Stick.Modifiers.Add(DeadZone(IMC, GamepadDeadZone));
		Stick.Modifiers.Add(NewObject<UInputModifierScaleByDeltaTime>(IMC));
		Stick.Modifiers.Add(Scalar(IMC, FVector(GamepadLookRate, GamepadLookRate * YSign, 1.f)));
	}

	// --- Кнопки ---
	IMC->MapKey(Actions.Sprint, EKeys::LeftShift);
	IMC->MapKey(Actions.Sprint, EKeys::Gamepad_LeftThumbstick);

	IMC->MapKey(Actions.SandWalk, EKeys::LeftAlt);
	IMC->MapKey(Actions.SandWalk, EKeys::Gamepad_LeftShoulder);

	IMC->MapKey(Actions.Stutter, EKeys::SpaceBar);
	IMC->MapKey(Actions.Stutter, EKeys::Gamepad_FaceButton_Bottom);

	IMC->MapKey(Actions.Interact, EKeys::E);
	IMC->MapKey(Actions.Interact, EKeys::Gamepad_FaceButton_Left);

	IMC->MapKey(Actions.ToggleCamera, EKeys::V);
	IMC->MapKey(Actions.ToggleCamera, EKeys::Gamepad_RightThumbstick);

	IMC->MapKey(Actions.Thumper, EKeys::T);
	IMC->MapKey(Actions.Thumper, EKeys::Gamepad_FaceButton_Top);

	IMC->MapKey(Actions.Pause, EKeys::Escape);
	IMC->MapKey(Actions.Pause, EKeys::Gamepad_Special_Right);

	IMC->MapKey(Actions.PhotoMode, EKeys::P);
	IMC->MapKey(Actions.PhotoMode, EKeys::Gamepad_Special_Left);
}

void ARakisPlayerController::AddMappingContextToPlayer()
{
	ULocalPlayer* LP = GetLocalPlayer();
	if (!LP)
	{
		return;
	}
	if (UEnhancedInputLocalPlayerSubsystem* Subsystem = LP->GetSubsystem<UEnhancedInputLocalPlayerSubsystem>())
	{
		UInputMappingContext* IMC = GetMappingContext();
		if (!Subsystem->HasMappingContext(IMC))
		{
			Subsystem->AddMappingContext(IMC, MappingPriority);
		}
	}
}

void ARakisPlayerController::SetupInputComponent()
{
	Super::SetupInputComponent();

	BuildInputObjects();

	if (UEnhancedInputComponent* EIC = Cast<UEnhancedInputComponent>(InputComponent))
	{
		EIC->BindAction(Actions.Pause, ETriggerEvent::Started, this, &ARakisPlayerController::HandlePause);
		EIC->BindAction(Actions.PhotoMode, ETriggerEvent::Started, this, &ARakisPlayerController::HandlePhotoMode);
	}
	else
	{
		UE_LOG(LogRakis, Warning, TEXT("RakisPlayerController: InputComponent is not UEnhancedInputComponent — check DefaultInput.ini"));
	}

	AddMappingContextToPlayer();
}

void ARakisPlayerController::BeginPlay()
{
	Super::BeginPlay();

	if (IsLocalController())
	{
		AddMappingContextToPlayer();
		SetInputMode(FInputModeGameOnly());
		bShowMouseCursor = false;
	}
}

void ARakisPlayerController::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	PlayWormRumble(0.f);
	Super::EndPlay(EndPlayReason);
}

void ARakisPlayerController::HandlePause()
{
	OnPauseRequested.Broadcast();
}

void ARakisPlayerController::HandlePhotoMode()
{
	OnPhotoModeRequested.Broadcast();
}

void ARakisPlayerController::PlayWormRumble(float Intensity01)
{
	const float Intensity = FMath::Clamp(Intensity01, 0.f, 1.f);

	if (RumbleHandle != 0)
	{
		PlayDynamicForceFeedback(0.f, 0.f, true, true, true, true, EDynamicForceFeedbackAction::Stop, RumbleHandle);
		RumbleHandle = 0;
	}

	if (Intensity <= KINDA_SMALL_NUMBER || !IsLocalController())
	{
		return;
	}

	// Низкий гул — большие моторы; мелкая дрожь малых моторов — только при близкой угрозе.
	const bool bSmallMotors = Intensity > 0.6f;
	RumbleHandle = PlayDynamicForceFeedback(Intensity, 0.5f, true, bSmallMotors, true, bSmallMotors,
		EDynamicForceFeedbackAction::Start, 0);
}

void ARakisPlayerController::ApplyWormThreat(float Threat01)
{
	const float Threat = FMath::Clamp(Threat01, 0.f, 1.f);

	// Тряска камеры.
	if (PlayerCameraManager && WormShakeClass)
	{
		const bool bInstanceAlive = IsValid(WormShakeInstance) && !WormShakeInstance->IsFinished();
		if (Threat > WormShakeThreshold)
		{
			const float Alpha = (Threat - WormShakeThreshold) / FMath::Max(1.f - WormShakeThreshold, KINDA_SMALL_NUMBER);
			const float Scale = WormShakeMaxScale * Alpha * Alpha;
			if (!bInstanceAlive)
			{
				WormShakeInstance = PlayerCameraManager->StartCameraShake(WormShakeClass, Scale);
			}
			else
			{
				WormShakeInstance->ShakeScale = Scale;
			}
		}
		else if (bInstanceAlive)
		{
			PlayerCameraManager->StopCameraShake(WormShakeInstance, false);
			WormShakeInstance = nullptr;
		}
	}

	// Вибрация.
	if (Threat > WormRumbleThreshold)
	{
		const float Alpha = (Threat - WormRumbleThreshold) / FMath::Max(1.f - WormRumbleThreshold, KINDA_SMALL_NUMBER);
		PlayWormRumble(WormRumbleMax * FMath::Pow(Alpha, 1.5f));
	}
	else if (RumbleHandle != 0)
	{
		PlayWormRumble(0.f);
	}
}
