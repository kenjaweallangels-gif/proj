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
	if (UBrushComponent* BrushComp = GetBrushComponent())
	{
		// Имя BrushComp, а не Brush: ABrush::Brush (UModel*) — член базового класса, тень = ошибка C4458 в UE5.
		// Профиль Trigger: перекрытия со всем, без блокировки.
		BrushComp->SetCollisionProfileName(UCollisionProfile::CustomCollisionProfileName);
		BrushComp->SetCollisionEnabled(ECollisionEnabled::QueryOnly);
		BrushComp->SetCollisionObjectType(ECC_WorldDynamic);
		BrushComp->SetCollisionResponseToAllChannels(ECR_Ignore);
		BrushComp->SetCollisionResponseToChannel(ECC_Pawn, ECR_Overlap);
		BrushComp->SetGenerateOverlapEvents(true);
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
