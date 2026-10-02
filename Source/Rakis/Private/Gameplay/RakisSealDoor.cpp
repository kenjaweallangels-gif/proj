#include "Gameplay/RakisSealDoor.h"

#include "Components/BoxComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/CollisionProfile.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "GameFramework/Pawn.h"
#include "Gameplay/RakisAssetUtils.h"
#include "Kismet/GameplayStatics.h"
#include "NiagaraComponent.h"
#include "NiagaraFunctionLibrary.h"
#include "NiagaraSystem.h"
#include "Sound/SoundBase.h"
#include "TimerManager.h"
#include "UObject/ConstructorHelpers.h"

#define LOCTEXT_NAMESPACE "RakisSealDoor"

ARakisSealDoor::ARakisSealDoor()
{
	PrimaryActorTick.bCanEverTick = false;

	SceneRoot = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	SetRootComponent(SceneRoot);

	LeftHinge = CreateDefaultSubobject<USceneComponent>(TEXT("LeftHinge"));
	LeftHinge->SetupAttachment(SceneRoot);
	RightHinge = CreateDefaultSubobject<USceneComponent>(TEXT("RightHinge"));
	RightHinge->SetupAttachment(SceneRoot);

	LeftPanel = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("LeftPanel"));
	LeftPanel->SetupAttachment(LeftHinge);
	LeftPanel->SetCollisionProfileName(UCollisionProfile::BlockAllDynamic_ProfileName);

	RightPanel = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("RightPanel"));
	RightPanel->SetupAttachment(RightHinge);
	RightPanel->SetCollisionProfileName(UCollisionProfile::BlockAllDynamic_ProfileName);

	Doorway = CreateDefaultSubobject<UBoxComponent>(TEXT("Doorway"));
	Doorway->SetupAttachment(SceneRoot);
	Doorway->SetCollisionEnabled(ECollisionEnabled::QueryOnly);
	Doorway->SetCollisionResponseToAllChannels(ECR_Ignore);
	Doorway->SetCollisionResponseToChannel(ECC_Pawn, ECR_Overlap);
	Doorway->SetCollisionResponseToChannel(ECC_GameTraceChannel1, ECR_Block); // "Interact"
	Doorway->SetGenerateOverlapEvents(true);
	Doorway->SetCanEverAffectNavigation(false);

	static ConstructorHelpers::FObjectFinder<UStaticMesh> CubeFinder(TEXT("/Engine/BasicShapes/Cube.Cube"));
	if (CubeFinder.Succeeded())
	{
		FallbackCubeMesh = CubeFinder.Object;
	}

	PanelMeshAsset = TSoftObjectPtr<UStaticMesh>(FSoftObjectPath(TEXT("/Game/Rakis/Environment/Sietch/SM_Sietch_SealDoor_Panel.SM_Sietch_SealDoor_Panel")));
	SteamFX = TSoftObjectPtr<UNiagaraSystem>(FSoftObjectPath(TEXT("/Game/Rakis/FX/NS_SealDoor_Steam.NS_SealDoor_Steam")));
	HissSound = TSoftObjectPtr<USoundBase>(FSoftObjectPath(TEXT("/Game/Rakis/Audio/MetaSounds/MS_SealDoor.MS_SealDoor")));

	OpenVerb = LOCTEXT("Open", "Open");
	CloseVerb = LOCTEXT("Close", "Close");
}

void ARakisSealDoor::SetupPanels()
{
	UStaticMesh* Mesh = RakisAssets::Load(PanelMeshAsset, TEXT("RakisSealDoor.PanelMesh"), false);
	bUsingFallbackPanel = (Mesh == nullptr);
	if (bUsingFallbackPanel)
	{
		Mesh = FallbackCubeMesh;
	}
	if (Mesh)
	{
		PanelMeshSize = (Mesh->GetBounds().BoxExtent * 2.f).ComponentMax(FVector(1.f));
		LeftPanel->SetStaticMesh(Mesh);
		RightPanel->SetStaticMesh(Mesh);
	}

	const float W = PanelSize.Y;
	const float H = PanelSize.Z;
	// Петли — на внешних кромках проёма; створка смещена от петли к центру.
	LeftHinge->SetRelativeLocation(FVector(0.f, -W, 0.f));
	RightHinge->SetRelativeLocation(FVector(0.f, W, 0.f));

	const FVector Scale = PanelSize / PanelMeshSize;
	// Фоллбек-куб центрирован; авторская створка — ожидается пивот в центре (как у куба).
	LeftPanel->SetRelativeLocation(FVector(0.f, W * 0.5f, H * 0.5f));
	RightPanel->SetRelativeLocation(FVector(0.f, -W * 0.5f, H * 0.5f));
	LeftPanel->SetRelativeScale3D(Scale);
	RightPanel->SetRelativeScale3D(Scale);

	Doorway->SetRelativeLocation(FVector(0.f, 0.f, H * 0.5f));
	Doorway->SetBoxExtent(FVector(FMath::Max(PanelSize.X, 60.f) * 2.f, W, H * 0.5f));
}

void ARakisSealDoor::OnConstruction(const FTransform& Transform)
{
	Super::OnConstruction(Transform);
	SetupPanels();
	Alpha = bStartOpen ? 1.f : 0.f;
	ApplyAlpha(Alpha);
}

void ARakisSealDoor::BeginPlay()
{
	Super::BeginPlay();

	SetupPanels();
	LoadedSteamFX = RakisAssets::Load(SteamFX, TEXT("RakisSealDoor.SteamFX"));
	LoadedHissSound = RakisAssets::Load(HissSound, TEXT("RakisSealDoor.HissSound"));

	bTargetOpen = bStartOpen;
	Alpha = bStartOpen ? 1.f : 0.f;
	bSealed = !bStartOpen;
	ApplyAlpha(Alpha);
}

void ARakisSealDoor::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().ClearTimer(MotionTimer);
		World->GetTimerManager().ClearTimer(AutoCloseTimer);
	}
	Super::EndPlay(EndPlayReason);
}

FText ARakisSealDoor::GetInteractVerb() const
{
	return bTargetOpen ? CloseVerb : OpenVerb;
}

bool ARakisSealDoor::CanInteract(ARakisCharacter* Interactor) const
{
	return !bLocked && !bMoving;
}

void ARakisSealDoor::Interact(ARakisCharacter* Interactor)
{
	Toggle();
}

void ARakisSealDoor::Open()
{
	if (!bLocked)
	{
		StartMotion(true);
	}
}

void ARakisSealDoor::Close()
{
	StartMotion(false);
}

void ARakisSealDoor::Toggle()
{
	if (bTargetOpen) { Close(); } else { Open(); }
}

void ARakisSealDoor::StartMotion(bool bOpen)
{
	UWorld* World = GetWorld();
	if (!World || (bTargetOpen == bOpen && !bMoving && FMath::IsNearlyEqual(Alpha, bOpen ? 1.f : 0.f)))
	{
		return;
	}

	bTargetOpen = bOpen;
	bMoving = true;
	World->GetTimerManager().ClearTimer(AutoCloseTimer);

	if (bOpen && bSealed)
	{
		// Разгерметизация: шипение и выдох пара.
		bSealed = false;
		OnSealedChanged.Broadcast(false);
		PlayHissAndSteam(1.f);
	}

	OnDoorMoved.Broadcast(bOpen);

	LastStepTime = World->GetTimeSeconds();
	World->GetTimerManager().SetTimer(MotionTimer, this, &ARakisSealDoor::MotionStep, 1.f / 60.f, true);
}

void ARakisSealDoor::MotionStep()
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}
	const float Now = World->GetTimeSeconds();
	const float Dt = Now - LastStepTime;
	LastStepTime = Now;

	const float Target = bTargetOpen ? 1.f : 0.f;
	const float Duration = bTargetOpen ? OpenTime : CloseTime;
	Alpha = FMath::FInterpConstantTo(Alpha, Target, Dt, 1.f / Duration);
	ApplyAlpha(Alpha);

	if (FMath::IsNearlyEqual(Alpha, Target, 1.e-3f))
	{
		Alpha = Target;
		ApplyAlpha(Alpha);
		bMoving = false;
		World->GetTimerManager().ClearTimer(MotionTimer);

		if (bTargetOpen)
		{
			if (AutoCloseDelay > 0.f)
			{
				World->GetTimerManager().SetTimer(AutoCloseTimer, this, &ARakisSealDoor::TryAutoClose, AutoCloseDelay, false);
			}
		}
		else
		{
			// Запечатано: короткий хлопок уплотнителя.
			bSealed = true;
			OnSealedChanged.Broadcast(true);
			PlayHissAndSteam(0.5f);
		}
	}
}

void ARakisSealDoor::ApplyAlpha(float InAlpha)
{
	// Тяжёлая дверь: плавный старт и мягкая посадка.
	const float Eased = FMath::InterpEaseInOut(0.f, 1.f, FMath::Clamp(InAlpha, 0.f, 1.f), 2.f);
	const float W = PanelSize.Y;

	if (Motion == ERakisDoorMotion::Slide)
	{
		LeftHinge->SetRelativeLocationAndRotation(FVector(0.f, -W - Eased * SlideDistance, 0.f), FRotator::ZeroRotator);
		RightHinge->SetRelativeLocationAndRotation(FVector(0.f, W + Eased * SlideDistance, 0.f), FRotator::ZeroRotator);
	}
	else
	{
		LeftHinge->SetRelativeLocationAndRotation(FVector(0.f, -W, 0.f), FRotator(0.f, Eased * SwingAngle, 0.f));
		RightHinge->SetRelativeLocationAndRotation(FVector(0.f, W, 0.f), FRotator(0.f, -Eased * SwingAngle, 0.f));
	}
}

void ARakisSealDoor::TryAutoClose()
{
	// Кто-то стоит в проёме — ждём ещё.
	TArray<AActor*> Overlapping;
	Doorway->GetOverlappingActors(Overlapping, APawn::StaticClass());
	if (Overlapping.Num() > 0)
	{
		GetWorldTimerManager().SetTimer(AutoCloseTimer, this, &ARakisSealDoor::TryAutoClose, 1.f, false);
		return;
	}
	Close();
}

void ARakisSealDoor::PlayHissAndSteam(float Intensity)
{
	const FVector Center = GetActorLocation() + FVector(0.f, 0.f, PanelSize.Z * 0.5f);
	if (LoadedSteamFX)
	{
		if (UNiagaraComponent* FX = UNiagaraFunctionLibrary::SpawnSystemAtLocation(this, LoadedSteamFX, Center,
			GetActorRotation(), FVector(1.f), true, true, ENCPoolMethod::AutoRelease))
		{
			FX->SetVariableFloat(TEXT("User.Intensity"), Intensity);
		}
	}
	if (LoadedHissSound)
	{
		UGameplayStatics::PlaySoundAtLocation(this, LoadedHissSound, Center, FRotator::ZeroRotator, Intensity);
	}
}

#undef LOCTEXT_NAMESPACE
