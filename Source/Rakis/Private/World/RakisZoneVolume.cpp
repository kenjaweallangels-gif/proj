#include "World/RakisZoneVolume.h"

#include "Rakis.h"
#include "World/RakisZoneSubsystem.h"

#include "Components/BrushComponent.h"
#include "Engine/CollisionProfile.h"
#include "Engine/World.h"
#include "GameFramework/Pawn.h"
#include "Sound/ReverbEffect.h"

ARakisZoneVolume::ARakisZoneVolume(const FObjectInitializer& ObjectInitializer)
	: Super(ObjectInitializer)
{
	if (UBrushComponent* Brush = GetBrushComponent())
	{
		// Профиль Trigger: перекрытия со всем, без блокировки.
		Brush->SetCollisionProfileName(UCollisionProfile::CustomCollisionProfileName);
		Brush->SetCollisionEnabled(ECollisionEnabled::QueryOnly);
		Brush->SetCollisionObjectType(ECC_WorldDynamic);
		Brush->SetCollisionResponseToAllChannels(ECR_Ignore);
		Brush->SetCollisionResponseToChannel(ECC_Pawn, ECR_Overlap);
		Brush->SetGenerateOverlapEvents(true);
	}
	// Игрок, уже стоящий в объёме при подгрузке уровня, тоже должен «войти».
	bGenerateOverlapEventsDuringLevelStreaming = true;
}

void ARakisZoneVolume::BeginPlay()
{
	Super::BeginPlay();

	if (URakisZoneSubsystem* Zones = GetWorld() ? GetWorld()->GetSubsystem<URakisZoneSubsystem>() : nullptr)
	{
		Zones->RegisterVolume(this);
	}
}

void ARakisZoneVolume::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	if (URakisZoneSubsystem* Zones = GetWorld() ? GetWorld()->GetSubsystem<URakisZoneSubsystem>() : nullptr)
	{
		Zones->UnregisterVolume(this);
	}
	Super::EndPlay(EndPlayReason);
}

bool ARakisZoneVolume::IsLocalPlayerPawn(const AActor* Actor)
{
	const APawn* Pawn = Cast<APawn>(Actor);
	return Pawn && Pawn->IsPlayerControlled() && Pawn->IsLocallyControlled();
}

void ARakisZoneVolume::NotifyActorBeginOverlap(AActor* OtherActor)
{
	Super::NotifyActorBeginOverlap(OtherActor);

	if (IsLocalPlayerPawn(OtherActor))
	{
		if (URakisZoneSubsystem* Zones = GetWorld()->GetSubsystem<URakisZoneSubsystem>())
		{
			Zones->NotifyVolumeEntered(this);
		}
	}
}

void ARakisZoneVolume::NotifyActorEndOverlap(AActor* OtherActor)
{
	Super::NotifyActorEndOverlap(OtherActor);

	if (IsLocalPlayerPawn(OtherActor))
	{
		if (URakisZoneSubsystem* Zones = GetWorld()->GetSubsystem<URakisZoneSubsystem>())
		{
			Zones->NotifyVolumeExited(this);
		}
	}
}

bool ARakisZoneVolume::ContainsPoint(const FVector& Point) const
{
	return EncompassesPoint(Point, 0.f, nullptr);
}
