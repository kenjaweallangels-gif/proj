#include "Gameplay/RakisInspectable.h"

#include "Components/SphereComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Rakis.h"

#define LOCTEXT_NAMESPACE "RakisInspectable"

FRakisInspectDelegate ARakisInspectable::OnInspected;

ARakisInspectable::ARakisInspectable()
{
	PrimaryActorTick.bCanEverTick = false;

	FocusVolume = CreateDefaultSubobject<USphereComponent>(TEXT("FocusVolume"));
	SetRootComponent(FocusVolume);
	FocusVolume->InitSphereRadius(FocusRadius);
	FocusVolume->SetCollisionEnabled(ECollisionEnabled::QueryOnly);
	FocusVolume->SetCollisionResponseToAllChannels(ECR_Ignore);
	FocusVolume->SetCollisionResponseToChannel(ECC_GameTraceChannel1, ECR_Block); // "Interact"
	FocusVolume->SetGenerateOverlapEvents(false);
	FocusVolume->SetCanEverAffectNavigation(false);

	VisualMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("VisualMesh"));
	VisualMesh->SetupAttachment(FocusVolume);
	VisualMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

	InteractVerb = LOCTEXT("Inspect", "Inspect");
}

void ARakisInspectable::OnConstruction(const FTransform& Transform)
{
	Super::OnConstruction(Transform);

	FocusVolume->SetSphereRadius(FocusRadius);

	// Тег Rakis.POI.<LoreID>: убрать старые POI-теги и добавить актуальный.
	Tags.RemoveAll([](const FName& Tag) { return Tag.ToString().StartsWith(TEXT("Rakis.POI.")); });
	if (!LoreID.IsNone())
	{
		Tags.AddUnique(FName(*FString::Printf(TEXT("Rakis.POI.%s"), *LoreID.ToString())));
	}
}

bool ARakisInspectable::CanInteract(ARakisCharacter* Interactor) const
{
	return !(bOneShot && bInspected);
}

void ARakisInspectable::Interact(ARakisCharacter* Interactor)
{
	bInspected = true;
	if (LoreID.IsNone())
	{
		UE_LOG(LogRakis, Warning, TEXT("RakisInspectable %s: LoreID is not set"), *GetName());
	}
	OnInspected.Broadcast(LoreID);
	OnInspectedDynamic.Broadcast(LoreID);
}

#undef LOCTEXT_NAMESPACE
