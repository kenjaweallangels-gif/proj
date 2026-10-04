#include "Worm/RakisThumper.h"

#include "Components/StaticMeshComponent.h"
#include "Engine/CollisionProfile.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "Gameplay/RakisAssetUtils.h"
#include "Kismet/GameplayStatics.h"
#include "NiagaraComponent.h"
#include "NiagaraFunctionLibrary.h"
#include "NiagaraSystem.h"
#include "Noise/RakisNoiseSubsystem.h"
#include "Noise/RakisNoiseTuning.h"
#include "Player/RakisCharacter.h"
#include "Sound/SoundBase.h"
#include "TimerManager.h"
#include "UObject/ConstructorHelpers.h"

#define LOCTEXT_NAMESPACE "RakisThumper"

ARakisThumper::ARakisThumper()
{
	PrimaryActorTick.bCanEverTick = false;

	StakeMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Stake"));
	SetRootComponent(StakeMesh);
	StakeMesh->SetCollisionProfileName(UCollisionProfile::BlockAllDynamic_ProfileName);
	StakeMesh->SetCanEverAffectNavigation(false);

	static ConstructorHelpers::FObjectFinder<UStaticMesh> CylinderFinder(TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
	if (CylinderFinder.Succeeded())
	{
		FallbackStakeMesh = CylinderFinder.Object;
	}

	PulseFX = TSoftObjectPtr<UNiagaraSystem>(FSoftObjectPath(TEXT("/Game/Rakis/FX/NS_Thumper_Pulse.NS_Thumper_Pulse")));
	PulseSound = TSoftObjectPtr<USoundBase>(FSoftObjectPath(TEXT("/Game/Rakis/Audio/MetaSounds/MS_Thumper.MS_Thumper")));
	InteractVerb = LOCTEXT("PickUp", "Pick up");
}

void ARakisThumper::BeginPlay()
{
	Super::BeginPlay();

	UStaticMesh* Mesh = RakisAssets::Load(StakeMeshAsset, TEXT("RakisThumper.StakeMesh"), false);
	if (Mesh)
	{
		StakeMesh->SetStaticMesh(Mesh);
	}
	else if (FallbackStakeMesh)
	{
		// Кол Ø12 см, высота 140 см; основание — в точке актора (базовый цилиндр центрирован).
		StakeMesh->SetStaticMesh(FallbackStakeMesh);
		StakeMesh->SetWorldScale3D(FVector(0.12f, 0.12f, 1.4f));
		AddActorWorldOffset(FVector(0.f, 0.f, 70.f));
	}

	LoadedPulseFX = RakisAssets::Load(PulseFX, TEXT("RakisThumper.PulseFX"));
	LoadedPulseSound = RakisAssets::Load(PulseSound, TEXT("RakisThumper.PulseSound"));

	if (bStartThumpingOnSpawn)
	{
		StartThumping();
	}
}

void ARakisThumper::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	StopThumping();
	Super::EndPlay(EndPlayReason);
}

void ARakisThumper::StartThumping()
{
	UWorld* World = GetWorld();
	if (!World || bThumping)
	{
		return;
	}
	bThumping = true;
	const float Interval = FMath::Max(0.1f, URakisNoiseTuning::Get()->ThumperInterval);
	World->GetTimerManager().SetTimer(PulseTimer, this, &ARakisThumper::Pulse, Interval, true, 0.2f);
	World->GetTimerManager().SetTimer(LifetimeTimer, this, &ARakisThumper::StopThumping, Lifetime, false);
}

void ARakisThumper::StopThumping()
{
	bThumping = false;
	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().ClearTimer(PulseTimer);
		World->GetTimerManager().ClearTimer(LifetimeTimer);
	}
}

void ARakisThumper::Pulse()
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}

	const FVector Base = GetActorLocation() - FVector(0.f, 0.f, 60.f);

	if (URakisNoiseSubsystem* Noise = World->GetSubsystem<URakisNoiseSubsystem>())
	{
		static const FName ThumperSource(TEXT("Thumper"));
		Noise->ReportNoise(FRakisNoiseEvent(Base, URakisNoiseTuning::Get()->ThumperLoudness, ThumperSource));
	}

	if (LoadedPulseFX)
	{
		if (UNiagaraComponent* FX = UNiagaraFunctionLibrary::SpawnSystemAtLocation(this, LoadedPulseFX, Base,
			FRotator::ZeroRotator, FVector(1.f), true, true, ENCPoolMethod::AutoRelease))
		{
			FX->SetVariableFloat(TEXT("User.Intensity"), 1.f);
		}
	}

	if (LoadedPulseSound)
	{
		UGameplayStatics::PlaySoundAtLocation(this, LoadedPulseSound, Base);
	}

	OnPulse.Broadcast();
}

void ARakisThumper::Interact(ARakisCharacter* Interactor)
{
	if (!Interactor)
	{
		return;
	}
	Interactor->AddThumperCharges(1);
	StopThumping();
	Destroy();
}

#undef LOCTEXT_NAMESPACE
