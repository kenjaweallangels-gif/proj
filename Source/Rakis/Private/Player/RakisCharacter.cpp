#include "Player/RakisCharacter.h"

#include "Camera/CameraComponent.h"
#include "Components/AudioComponent.h"
#include "Components/CapsuleComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "EnhancedInputComponent.h"
#include "Engine/SkeletalMesh.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "GameFramework/SpringArmComponent.h"
#include "Gameplay/RakisAssetUtils.h"
#include "Hydration/RakisHydrationComponent.h"
#include "InputAction.h"
#include "InputActionValue.h"
#include "Interaction/RakisInteractionComponent.h"
#include "Kismet/GameplayStatics.h"
#include "NiagaraComponent.h"
#include "NiagaraFunctionLibrary.h"
#include "NiagaraSystem.h"
#include "Noise/RakisSandWalkComponent.h"
#include "PhysicalMaterials/PhysicalMaterial.h"
#include "Player/RakisPlayerController.h"
#include "Rakis.h"
#include "Sound/SoundBase.h"
#include "TimerManager.h"
#include "UObject/ConstructorHelpers.h"
#include "Worm/RakisThumper.h"

ARakisCharacter::ARakisCharacter()
{
	// Tick включается только на время перехода камеры FP↔TP.
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.bStartWithTickEnabled = false;

	GetCapsuleComponent()->InitCapsuleSize(34.f, 88.f);

	bUseControllerRotationPitch = false;
	bUseControllerRotationYaw = false;
	bUseControllerRotationRoll = false;

	UCharacterMovementComponent* Move = GetCharacterMovement();
	Move->bOrientRotationToMovement = true;
	Move->RotationRate = FRotator(0.f, 420.f, 0.f);
	Move->MaxWalkSpeed = WalkSpeed;
	Move->MinAnalogWalkSpeed = 20.f;
	Move->BrakingDecelerationWalking = 1400.f;
	Move->GroundFriction = 6.f;
	Move->bCanWalkOffLedgesWhenCrouching = true;

	GetMesh()->SetRelativeLocationAndRotation(FVector(0.f, 0.f, -88.f), FRotator(0.f, -90.f, 0.f));

	CameraBoom = CreateDefaultSubobject<USpringArmComponent>(TEXT("CameraBoom"));
	CameraBoom->SetupAttachment(RootComponent);
	CameraBoom->TargetArmLength = ThirdPersonArmLength;
	CameraBoom->SocketOffset = ThirdPersonSocketOffset;
	CameraBoom->bUsePawnControlRotation = true;
	CameraBoom->bEnableCameraLag = true;
	CameraBoom->CameraLagSpeed = 12.f;
	CameraBoom->ProbeSize = 14.f;

	ThirdPersonCamera = CreateDefaultSubobject<UCameraComponent>(TEXT("ThirdPersonCamera"));
	ThirdPersonCamera->SetupAttachment(CameraBoom, USpringArmComponent::SocketName);
	ThirdPersonCamera->bUsePawnControlRotation = false;
	ThirdPersonCamera->SetFieldOfView(ThirdPersonFOV);

	FirstPersonCamera = CreateDefaultSubobject<UCameraComponent>(TEXT("FirstPersonCamera"));
	FirstPersonCamera->SetupAttachment(RootComponent);
	FirstPersonCamera->SetRelativeLocation(FirstPersonFallbackOffset);
	FirstPersonCamera->bUsePawnControlRotation = true;
	FirstPersonCamera->SetFieldOfView(FirstPersonFOV);
	FirstPersonCamera->SetAutoActivate(false);

	BlockoutBody = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("BlockoutBody"));
	BlockoutBody->SetupAttachment(RootComponent);
	BlockoutBody->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	BlockoutBody->SetGenerateOverlapEvents(false);
	BlockoutBody->SetCanEverAffectNavigation(false);
	BlockoutBody->SetRelativeScale3D(FVector(0.68f, 0.68f, 1.76f));
	BlockoutBody->SetHiddenInGame(true);
	static ConstructorHelpers::FObjectFinder<UStaticMesh> CylinderFinder(TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
	if (CylinderFinder.Succeeded())
	{
		BlockoutBody->SetStaticMesh(CylinderFinder.Object);
	}

	NoiseComponent = CreateDefaultSubobject<URakisNoiseComponent>(TEXT("Noise"));
	HydrationComponent = CreateDefaultSubobject<URakisHydrationComponent>(TEXT("Hydration"));
	SandWalkComponent = CreateDefaultSubobject<URakisSandWalkComponent>(TEXT("SandWalk"));
	InteractionComponent = CreateDefaultSubobject<URakisInteractionComponent>(TEXT("Interaction"));

	FootstepSandFX = TSoftObjectPtr<UNiagaraSystem>(FSoftObjectPath(TEXT("/Game/Rakis/FX/NS_Footstep_Sand.NS_Footstep_Sand")));
	FootstepSound = TSoftObjectPtr<USoundBase>(FSoftObjectPath(TEXT("/Game/Rakis/Audio/MetaSounds/MS_Footstep.MS_Footstep")));
	ThumperClass = ARakisThumper::StaticClass();
}

void ARakisCharacter::BeginPlay()
{
	Super::BeginPlay();

	// Значения из EditDefaultsOnly могли быть изменены в BP-наследнике — применяем ещё раз.
	CameraBoom->TargetArmLength = ThirdPersonArmLength;
	CameraBoom->SocketOffset = ThirdPersonSocketOffset;
	ThirdPersonCamera->SetFieldOfView(ThirdPersonFOV);
	FirstPersonCamera->SetFieldOfView(FirstPersonFOV);

	// Блокаут: без скелетного меша показываем цилиндр, чтобы персонаж был виден в 3-м лице.
	const bool bHasSkeletalMesh = GetMesh() && GetMesh()->GetSkeletalMeshAsset() != nullptr;
	BlockoutBody->SetHiddenInGame(bHasSkeletalMesh);

	SetupFirstPersonCameraAttachment();

	LoadedFootstepFX = RakisAssets::Load(FootstepSandFX, TEXT("RakisCharacter.FootstepSandFX"));
	LoadedFootstepSound = RakisAssets::Load(FootstepSound, TEXT("RakisCharacter.FootstepSound"));

	if (UWorld* World = GetWorld())
	{
		LastFallbackTime = World->GetTimeSeconds();
		World->GetTimerManager().SetTimer(FootstepTimer, this, &ARakisCharacter::UpdateFootstepFallback, 1.f / FootstepTimerHz, true);
		World->GetTimerManager().SetTimer(SurfaceTimer, this, &ARakisCharacter::UpdateSurface, 1.f / SurfaceCheckHz, true);
	}

	// Начальный режим камеры — без перехода.
	bFirstPerson = bStartInFirstPerson;
	CameraAlpha = bFirstPerson ? 1.f : 0.f;
	ApplyRotationMode(bFirstPerson);
	FinishCameraBlend();

	UpdateSurface();
	UpdateGait();
}

void ARakisCharacter::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().ClearTimer(FootstepTimer);
		World->GetTimerManager().ClearTimer(SurfaceTimer);
		World->GetTimerManager().ClearTimer(StutterTimer);
	}
	Super::EndPlay(EndPlayReason);
}

void ARakisCharacter::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
	Super::SetupPlayerInputComponent(PlayerInputComponent);

	ARakisPlayerController* PC = Cast<ARakisPlayerController>(Controller);
	UEnhancedInputComponent* EIC = Cast<UEnhancedInputComponent>(PlayerInputComponent);
	if (!PC || !EIC)
	{
		UE_LOG(LogRakis, Warning, TEXT("RakisCharacter: needs ARakisPlayerController and UEnhancedInputComponent to bind input"));
		return;
	}

	const FRakisInputActions& A = PC->GetInputActions();
	EIC->BindAction(A.Move, ETriggerEvent::Triggered, this, &ARakisCharacter::Input_Move);
	EIC->BindAction(A.Look, ETriggerEvent::Triggered, this, &ARakisCharacter::Input_Look);
	EIC->BindAction(A.Sprint, ETriggerEvent::Started, this, &ARakisCharacter::Input_SprintStarted);
	EIC->BindAction(A.Sprint, ETriggerEvent::Completed, this, &ARakisCharacter::Input_SprintCompleted);
	EIC->BindAction(A.SandWalk, ETriggerEvent::Started, this, &ARakisCharacter::Input_SandWalkStarted);
	EIC->BindAction(A.SandWalk, ETriggerEvent::Completed, this, &ARakisCharacter::Input_SandWalkCompleted);
	EIC->BindAction(A.Stutter, ETriggerEvent::Started, this, &ARakisCharacter::Input_Stutter);
	EIC->BindAction(A.Interact, ETriggerEvent::Started, this, &ARakisCharacter::Input_Interact);
	EIC->BindAction(A.ToggleCamera, ETriggerEvent::Started, this, &ARakisCharacter::Input_ToggleCamera);
	EIC->BindAction(A.Thumper, ETriggerEvent::Started, this, &ARakisCharacter::Input_Thumper);
}

// ---------------------------------------------------------------------------------------------
// Ввод

void ARakisCharacter::Input_Move(const FInputActionValue& Value)
{
	if (bInputLocked || !Controller)
	{
		return;
	}
	const FVector2D Axis = Value.Get<FVector2D>();
	const FRotator YawRotation(0.f, Controller->GetControlRotation().Yaw, 0.f);
	const FRotationMatrix YawMatrix(YawRotation);
	AddMovementInput(YawMatrix.GetUnitAxis(EAxis::X), Axis.Y);
	AddMovementInput(YawMatrix.GetUnitAxis(EAxis::Y), Axis.X);
}

void ARakisCharacter::Input_Look(const FInputActionValue& Value)
{
	if (bInputLocked || !Controller)
	{
		return;
	}
	// Значение уже в градусах (масштаб — в контексте ввода ARakisPlayerController).
	const FVector2D Axis = Value.Get<FVector2D>();
	FRotator Rotation = Controller->GetControlRotation();
	Rotation.Yaw = FRotator::NormalizeAxis(Rotation.Yaw + Axis.X);
	Rotation.Pitch = FMath::Clamp(FRotator::NormalizeAxis(Rotation.Pitch + Axis.Y), MinViewPitch, MaxViewPitch);
	Rotation.Roll = 0.f;
	Controller->SetControlRotation(Rotation);
}

void ARakisCharacter::Input_SprintStarted()
{
	bSprintHeld = true;
	UpdateGait();
}

void ARakisCharacter::Input_SprintCompleted()
{
	bSprintHeld = false;
	UpdateGait();
}

void ARakisCharacter::Input_SandWalkStarted()
{
	if (bInputLocked)
	{
		return;
	}
	SandWalkComponent->SetSandWalking(true);
	UpdateGait();
}

void ARakisCharacter::Input_SandWalkCompleted()
{
	SandWalkComponent->SetSandWalking(false);
	UpdateGait();
}

void ARakisCharacter::Input_Stutter()
{
	if (bInputLocked || !SandWalkComponent->TryStutter())
	{
		return;
	}

	// «Сбивка»: немедленный неровный полушаг, затем пауза (отрицательный накопитель дистанции)
	// и короткое замедление — интервалы между шагами становятся нерегулярными.
	const float Speed = GetVelocity().Size2D();
	if (GetCharacterMovement()->IsMovingOnGround() && Speed > 20.f)
	{
		HandleFootstep(bNextLeftFoot);
		bNextLeftFoot = !bNextLeftFoot;
		StepDistanceAccum = -GetStepLength(Speed) * FMath::FRandRange(StutterPauseMin, StutterPauseMax);
	}

	bStutterSlow = true;
	UpdateGait();
	GetWorldTimerManager().SetTimer(StutterTimer, this, &ARakisCharacter::EndStutterSlow, FMath::Max(0.01f, StutterSlowTime), false);
}

void ARakisCharacter::EndStutterSlow()
{
	bStutterSlow = false;
	UpdateGait();
}

void ARakisCharacter::Input_Interact()
{
	if (!bInputLocked)
	{
		InteractionComponent->TryInteract();
	}
}

void ARakisCharacter::Input_ToggleCamera()
{
	if (!bInputLocked)
	{
		ToggleCameraMode();
	}
}

void ARakisCharacter::Input_Thumper()
{
	if (!bInputLocked)
	{
		DeployThumper();
	}
}

void ARakisCharacter::SetInputLocked(bool bLocked)
{
	bInputLocked = bLocked;
	if (bLocked)
	{
		GetCharacterMovement()->StopMovementImmediately();
		bSprintHeld = false;
		SandWalkComponent->SetSandWalking(false);
		SandWalkComponent->ResetRhythm();
	}
	InteractionComponent->SetInteractionEnabled(!bLocked);
	UpdateGait();
}

void ARakisCharacter::UpdateGait()
{
	if (SandWalkComponent->IsSandWalking())
	{
		Gait = ERakisGait::SandWalk;
	}
	else if (bSprintHeld)
	{
		Gait = ERakisGait::Run;
	}
	else
	{
		Gait = ERakisGait::Walk;
	}

	float Speed = WalkSpeed;
	switch (Gait)
	{
	case ERakisGait::Run:		Speed = RunSpeed; break;
	case ERakisGait::SandWalk:	Speed = SandWalkSpeed * (bStutterSlow ? StutterSpeedFactor : 1.f); break;
	default: break;
	}
	GetCharacterMovement()->MaxWalkSpeed = Speed;

	HydrationComponent->SetExerting(Gait == ERakisGait::Run);
}

// ---------------------------------------------------------------------------------------------
// Камера

void ARakisCharacter::SetupFirstPersonCameraAttachment()
{
	USkeletalMeshComponent* SkelMesh = GetMesh();
	if (SkelMesh && SkelMesh->GetSkeletalMeshAsset() && SkelMesh->DoesSocketExist(HeadSocketName))
	{
		FirstPersonCamera->AttachToComponent(SkelMesh, FAttachmentTransformRules::SnapToTargetNotIncludingScale, HeadSocketName);
		FirstPersonCamera->SetRelativeLocation(FirstPersonSocketOffset);
	}
	else
	{
		// Фоллбек: высота глаз относительно капсулы.
		FirstPersonCamera->AttachToComponent(RootComponent, FAttachmentTransformRules::KeepRelativeTransform);
		FirstPersonCamera->SetRelativeLocation(FirstPersonFallbackOffset);
	}
	FirstPersonCamera->bUsePawnControlRotation = true;
}

void ARakisCharacter::ApplyRotationMode(bool bFirstPersonMode)
{
	// 1-е лицо: тело плавно доворачивается к взгляду; 3-е: тело по направлению движения.
	UCharacterMovementComponent* Move = GetCharacterMovement();
	Move->bOrientRotationToMovement = !bFirstPersonMode;
	Move->bUseControllerDesiredRotation = bFirstPersonMode;
}

void ARakisCharacter::SetFirstPerson(bool bEnable)
{
	if (bEnable == bFirstPerson)
	{
		return;
	}
	bFirstPerson = bEnable;
	ApplyRotationMode(bFirstPerson);

	if (!bFirstPerson)
	{
		// Выход из 1-го лица: TP-камера стартует из головы и «отъезжает» назад.
		ThirdPersonCamera->SetWorldLocation(FirstPersonCamera->GetComponentLocation());
		ThirdPersonCamera->SetFieldOfView(FirstPersonFOV);
		FirstPersonCamera->SetActive(false);
		ThirdPersonCamera->SetActive(true);
		SetHeadHidden(false);
	}

	bBlending = true;
	SetActorTickEnabled(true);
}

void ARakisCharacter::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	if (!bBlending)
	{
		SetActorTickEnabled(false);
		return;
	}

	const float Target = bFirstPerson ? 1.f : 0.f;
	CameraAlpha = FMath::FInterpConstantTo(CameraAlpha, Target, DeltaSeconds, 1.f / CameraBlendTime);
	const float Eased = FMath::SmoothStep(0.f, 1.f, CameraAlpha);

	const FVector BoomEnd = CameraBoom->GetSocketLocation(USpringArmComponent::SocketName);
	const FVector HeadView = FirstPersonCamera->GetComponentLocation();
	ThirdPersonCamera->SetWorldLocation(FMath::Lerp(BoomEnd, HeadView, Eased));
	ThirdPersonCamera->SetFieldOfView(FMath::Lerp(ThirdPersonFOV, FirstPersonFOV, Eased));

	// Голову прячем чуть раньше конца перехода, чтобы камера не «прошла» через неё.
	if (bFirstPerson && CameraAlpha > 0.85f)
	{
		SetHeadHidden(true);
	}

	if (FMath::IsNearlyEqual(CameraAlpha, Target, 1.e-3f))
	{
		CameraAlpha = Target;
		FinishCameraBlend();
	}
}

void ARakisCharacter::FinishCameraBlend()
{
	bBlending = false;
	SetActorTickEnabled(false);

	ThirdPersonCamera->SetRelativeLocation(FVector::ZeroVector);
	ThirdPersonCamera->SetFieldOfView(ThirdPersonFOV);

	FirstPersonCamera->SetActive(bFirstPerson);
	ThirdPersonCamera->SetActive(!bFirstPerson);
	SetHeadHidden(bFirstPerson);
}

void ARakisCharacter::SetHeadHidden(bool bHidden)
{
	if (bHeadHidden == bHidden)
	{
		return;
	}
	bHeadHidden = bHidden;

	BlockoutBody->SetOwnerNoSee(bHidden);

	USkeletalMeshComponent* SkelMesh = GetMesh();
	if (SkelMesh && SkelMesh->GetSkeletalMeshAsset() && SkelMesh->GetBoneIndex(HeadSocketName) != INDEX_NONE)
	{
		if (bHidden)
		{
			SkelMesh->HideBoneByName(HeadSocketName, EPhysBodyOp::PBO_None);
		}
		else
		{
			SkelMesh->UnHideBoneByName(HeadSocketName);
		}
	}
}

// ---------------------------------------------------------------------------------------------
// Поверхность и шаги

ERakisSurface ARakisCharacter::SurfaceFromPhysicalSurface(EPhysicalSurface Surface)
{
	switch (Surface)
	{
	case SurfaceType1: return ERakisSurface::Sand;
	case SurfaceType2: return ERakisSurface::Rock;
	case SurfaceType3: return ERakisSurface::SietchStone;
	case SurfaceType4: return ERakisSurface::Cloth;
	case SurfaceType5: return ERakisSurface::Metal;
	case SurfaceType6: return ERakisSurface::PackedSand;
	default:           return ERakisSurface::Unknown;
	}
}

ERakisSurface ARakisCharacter::SurfaceFromHit(const FHitResult& Hit) const
{
	// 1) Теги-переопределения (удобно на блокауте: "Rakis.Surface.Rock").
	const UEnum* SurfaceEnum = StaticEnum<ERakisSurface>();
	const AActor* HitActor = Hit.GetActor();
	const UPrimitiveComponent* HitComponent = Hit.GetComponent();
	if (SurfaceEnum && (HitActor || HitComponent))
	{
		auto CheckTags = [&](const TArray<FName>& Tags, ERakisSurface& Out) -> bool
		{
			for (const FName& Tag : Tags)
			{
				const FString TagString = Tag.ToString();
				if (TagString.StartsWith(SurfaceTagPrefix))
				{
					const int64 Value = SurfaceEnum->GetValueByNameString(TagString.RightChop(SurfaceTagPrefix.Len()));
					if (Value != INDEX_NONE)
					{
						Out = static_cast<ERakisSurface>(Value);
						return true;
					}
				}
			}
			return false;
		};

		ERakisSurface Tagged = ERakisSurface::Unknown;
		if ((HitComponent && CheckTags(HitComponent->ComponentTags, Tagged)) || (HitActor && CheckTags(HitActor->Tags, Tagged)))
		{
			return Tagged;
		}
	}

	// 2) Physical Material.
	const ERakisSurface FromMaterial = SurfaceFromPhysicalSurface(UPhysicalMaterial::DetermineSurfaceType(Hit.PhysMaterial.Get()));
	return FromMaterial != ERakisSurface::Unknown ? FromMaterial : DefaultSurface;
}

void ARakisCharacter::UpdateSurface()
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}

	const float HalfHeight = GetCapsuleComponent()->GetScaledCapsuleHalfHeight();
	const FVector Start = GetActorLocation();
	const FVector End = Start - FVector(0.f, 0.f, HalfHeight + 80.f);

	FCollisionQueryParams Params(SCENE_QUERY_STAT(RakisSurfaceTrace), false, this);
	Params.bReturnPhysicalMaterial = true;

	FHitResult Hit;
	if (World->LineTraceSingleByChannel(Hit, Start, End, ECC_Visibility, Params))
	{
		CurrentSurface = SurfaceFromHit(Hit);
	}
	// В воздухе оставляем последнюю известную поверхность.
}

float ARakisCharacter::GetStepLength(float Speed) const
{
	const float Alpha = FMath::GetRangePct(SandWalkSpeed, RunSpeed, Speed);
	return FMath::Lerp(StepLengthSlow, StepLengthFast, FMath::Clamp(Alpha, 0.f, 1.f));
}

FVector ARakisCharacter::GetFootLocation(bool bLeftFoot) const
{
	const FName Socket = bLeftFoot ? LeftFootSocket : RightFootSocket;
	const USkeletalMeshComponent* SkelMesh = GetMesh();
	if (SkelMesh && SkelMesh->GetSkeletalMeshAsset() && SkelMesh->DoesSocketExist(Socket))
	{
		return SkelMesh->GetSocketLocation(Socket);
	}
	const float HalfHeight = GetCapsuleComponent()->GetScaledCapsuleHalfHeight();
	const FVector Side = GetActorRightVector() * (bLeftFoot ? -12.f : 12.f);
	return GetActorLocation() - FVector(0.f, 0.f, HalfHeight) + Side;
}

void ARakisCharacter::OnFootstep(bool bLeftFoot)
{
	if (const UWorld* World = GetWorld())
	{
		LastAnimFootstepTime = World->GetTimeSeconds();
	}
	HandleFootstep(bLeftFoot);
}

void ARakisCharacter::UpdateFootstepFallback()
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}
	const float Now = World->GetTimeSeconds();
	const float Dt = Now - LastFallbackTime;
	LastFallbackTime = Now;

	// Анимация сама шлёт шаги — фоллбек молчит.
	if (Now - LastAnimFootstepTime < AnimFootstepTimeout)
	{
		StepDistanceAccum = 0.f;
		return;
	}

	const float Speed = GetVelocity().Size2D();
	if (!GetCharacterMovement()->IsMovingOnGround() || Speed < 20.f)
	{
		// Стоим — следующий шаг начнётся «с полушага».
		StepDistanceAccum = FMath::Min(StepDistanceAccum, GetStepLength(WalkSpeed) * 0.5f);
		return;
	}

	StepDistanceAccum += Speed * Dt;
	const float StepLength = GetStepLength(Speed);
	if (StepDistanceAccum >= StepLength)
	{
		StepDistanceAccum = FMath::Fmod(StepDistanceAccum, StepLength);
		HandleFootstep(bNextLeftFoot);
		bNextLeftFoot = !bNextLeftFoot;
	}
}

void ARakisCharacter::HandleFootstep(bool bLeftFoot)
{
	if (!GetCharacterMovement()->IsMovingOnGround())
	{
		return;
	}

	UpdateSurface();

	const float Regularity = SandWalkComponent->RegisterStep();
	const float Loudness = NoiseComponent->ComputeFootstepLoudness(Gait, CurrentSurface, Regularity);
	const FVector FootLocation = GetFootLocation(bLeftFoot);

	static const FName FootstepSource(TEXT("Footstep"));
	NoiseComponent->AddNoiseAt(Loudness, FootstepSource, FootLocation);

	const bool bSandy = CurrentSurface == ERakisSurface::Sand || CurrentSurface == ERakisSurface::PackedSand;
	const float Speed01 = FMath::Clamp(GetVelocity().Size2D() / FMath::Max(RunSpeed, 1.f), 0.f, 1.f);

	if (bSandy && LoadedFootstepFX)
	{
		if (UNiagaraComponent* FX = UNiagaraFunctionLibrary::SpawnSystemAtLocation(this, LoadedFootstepFX, FootLocation,
			GetActorRotation(), FVector(1.f), true, true, ENCPoolMethod::AutoRelease))
		{
			FX->SetVariableFloat(TEXT("User.Intensity"), Speed01);
		}
	}

	if (LoadedFootstepSound)
	{
		if (UAudioComponent* Audio = UGameplayStatics::SpawnSoundAtLocation(this, LoadedFootstepSound, FootLocation,
			FRotator::ZeroRotator, FootstepVolume))
		{
			// Параметры MetaSound MS_Footstep (docs/audio): поверхность, скорость, громкость шага.
			Audio->SetIntParameter(TEXT("Surface"), static_cast<int32>(CurrentSurface));
			Audio->SetFloatParameter(TEXT("Speed"), Speed01);
			Audio->SetFloatParameter(TEXT("Loudness"), Loudness);
		}
	}
}

// ---------------------------------------------------------------------------------------------
// Тампер

bool ARakisCharacter::DeployThumper()
{
	UWorld* World = GetWorld();
	if (!World || !ThumperClass || ThumperCharges <= 0)
	{
		return false;
	}
	if (CurrentSurface != ERakisSurface::Sand && CurrentSurface != ERakisSurface::PackedSand)
	{
		// Тампер вбивают только в песок.
		return false;
	}

	const FVector Forward = GetActorForwardVector().GetSafeNormal2D();
	const FVector Probe = GetActorLocation() + Forward * ThumperPlaceDistance;

	FCollisionQueryParams Params(SCENE_QUERY_STAT(RakisThumperPlace), false, this);
	FHitResult Hit;
	if (!World->LineTraceSingleByChannel(Hit, Probe + FVector(0.f, 0.f, 100.f), Probe - FVector(0.f, 0.f, 400.f), ECC_Visibility, Params))
	{
		return false;
	}

	FActorSpawnParameters Spawn;
	Spawn.Owner = this;
	Spawn.Instigator = this;
	Spawn.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn;

	ARakisThumper* Thumper = World->SpawnActor<ARakisThumper>(ThumperClass, Hit.ImpactPoint, FRotator(0.f, GetActorRotation().Yaw, 0.f), Spawn);
	if (!Thumper)
	{
		return false;
	}
	--ThumperCharges;
	return true;
}
