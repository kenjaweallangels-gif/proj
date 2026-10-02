#include "Gameplay/RakisFalseRock.h"

#include "Components/StaticMeshComponent.h"
#include "Engine/CollisionProfile.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "Gameplay/RakisAssetUtils.h"
#include "Kismet/GameplayStatics.h"
#include "NiagaraComponent.h"
#include "NiagaraFunctionLibrary.h"
#include "NiagaraSystem.h"
#include "Sound/SoundBase.h"
#include "TimerManager.h"
#include "UObject/ConstructorHelpers.h"

#define LOCTEXT_NAMESPACE "RakisFalseRock"

ARakisFalseRock::ARakisFalseRock()
{
	PrimaryActorTick.bCanEverTick = false;

	SceneRoot = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	SetRootComponent(SceneRoot);

	Slab = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Slab"));
	Slab->SetupAttachment(SceneRoot);
	Slab->SetCollisionProfileName(UCollisionProfile::BlockAllDynamic_ProfileName);
	Slab->SetMobility(EComponentMobility::Movable);

	static ConstructorHelpers::FObjectFinder<UStaticMesh> CubeFinder(TEXT("/Engine/BasicShapes/Cube.Cube"));
	if (CubeFinder.Succeeded())
	{
		FallbackCubeMesh = CubeFinder.Object;
	}

	SlabMeshAsset = TSoftObjectPtr<UStaticMesh>(FSoftObjectPath(TEXT("/Game/Rakis/Environment/Rock/SM_Rock_FalseSlab.SM_Rock_FalseSlab")));
	DustFX = TSoftObjectPtr<UNiagaraSystem>(FSoftObjectPath(TEXT("/Game/Rakis/FX/NS_Rock_Hop.NS_Rock_Hop")));
	InteractVerb = LOCTEXT("Push", "Push");
}

void ARakisFalseRock::OnConstruction(const FTransform& Transform)
{
	Super::OnConstruction(Transform);

	UStaticMesh* Mesh = RakisAssets::Load(SlabMeshAsset, TEXT("RakisFalseRock.SlabMesh"), false);
	if (Mesh)
	{
		Slab->SetStaticMesh(Mesh);
		Slab->SetRelativeScale3D(FVector(1.f));
		Slab->SetRelativeLocation(FVector::ZeroVector);
	}
	else if (FallbackCubeMesh)
	{
		// Куб 100 см, основание — в точке актора.
		Slab->SetStaticMesh(FallbackCubeMesh);
		Slab->SetRelativeScale3D(FallbackSlabSize / 100.f);
		Slab->SetRelativeLocation(FVector(0.f, 0.f, FallbackSlabSize.Z * 0.5f));
	}
	Slab->SetRelativeRotation(FRotator::ZeroRotator);
	ClosedRelative = Slab->GetRelativeTransform();
}

void ARakisFalseRock::BeginPlay()
{
	Super::BeginPlay();
	ClosedRelative = Slab->GetRelativeTransform();
}

void ARakisFalseRock::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().ClearTimer(MoveTimer);
	}
	Super::EndPlay(EndPlayReason);
}

void ARakisFalseRock::Open()
{
	UWorld* World = GetWorld();
	if (!World || bOpened || bMoving)
	{
		return;
	}
	bMoving = true;

	const FVector Center = Slab->GetComponentLocation();
	if (UNiagaraSystem* FX = RakisAssets::Load(DustFX, TEXT("RakisFalseRock.DustFX"), false))
	{
		if (UNiagaraComponent* Comp = UNiagaraFunctionLibrary::SpawnSystemAtLocation(this, FX, Center, GetActorRotation()))
		{
			Comp->SetVariableFloat(TEXT("User.Intensity"), 0.6f);
		}
	}
	if (USoundBase* Sound = RakisAssets::Load(GrindSound, TEXT("RakisFalseRock.GrindSound"), false))
	{
		UGameplayStatics::PlaySoundAtLocation(this, Sound, Center);
	}

	OnStartedOpening.Broadcast();

	if (StartDelay > 0.f)
	{
		FTimerHandle DelayHandle;
		World->GetTimerManager().SetTimer(DelayHandle, this, &ARakisFalseRock::BeginMove, StartDelay, false);
	}
	else
	{
		BeginMove();
	}
}

void ARakisFalseRock::BeginMove()
{
	if (UWorld* World = GetWorld())
	{
		LastStepTime = World->GetTimeSeconds();
		World->GetTimerManager().SetTimer(MoveTimer, this, &ARakisFalseRock::MoveStep, 1.f / 60.f, true);
	}
}

void ARakisFalseRock::MoveStep()
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}
	const float Now = World->GetTimeSeconds();
	Alpha = FMath::Min(1.f, Alpha + (Now - LastStepTime) / OpenTime);
	LastStepTime = Now;
	ApplyAlpha(Alpha);

	if (Alpha >= 1.f)
	{
		World->GetTimerManager().ClearTimer(MoveTimer);
		bMoving = false;
		bOpened = true;
		OnOpened.Broadcast();
	}
}

void ARakisFalseRock::ApplyAlpha(float InAlpha)
{
	const float Eased = FMath::InterpEaseInOut(0.f, 1.f, InAlpha, 2.5f);
	const FVector Location = ClosedRelative.GetLocation() + OpenOffset * Eased;
	const FQuat Rotation = ClosedRelative.GetRotation() * FQuat::Slerp(FQuat::Identity, OpenRotation.Quaternion(), Eased);
	Slab->SetRelativeLocationAndRotation(Location, Rotation);
}

#undef LOCTEXT_NAMESPACE
