#include "Player/RakisGameMode.h"

#include "EngineUtils.h"
#include "Engine/World.h"
#include "GameFramework/HUD.h"
#include "Kismet/GameplayStatics.h"
#include "Player/RakisCharacter.h"
#include "Player/RakisPlayerController.h"
#include "Rakis.h"
#include "Worm/RakisWorm.h"

ARakisGameMode::ARakisGameMode()
{
	DefaultPawnClass = ARakisCharacter::StaticClass();
	PlayerControllerClass = ARakisPlayerController::StaticClass();
	WormClass = ARakisWorm::StaticClass();
}

void ARakisGameMode::ResolveHUDClass()
{
	// Класс HUD пишет UI-агент; связываемся по пути, без include, чтобы не было зависимости компиляции.
	if (UClass* Found = LoadClass<AHUD>(nullptr, *HUDClassPath, nullptr, LOAD_NoWarn | LOAD_Quiet))
	{
		HUDClass = Found;
	}
	else
	{
		UE_LOG(LogRakis, Warning, TEXT("RakisGameMode: HUD class '%s' not found, using default AHUD"), *HUDClassPath);
	}
}

void ARakisGameMode::InitGame(const FString& MapName, const FString& Options, FString& ErrorMessage)
{
	// До Super: HUDClass используется при логине игрока.
	ResolveHUDClass();
	Super::InitGame(MapName, Options, ErrorMessage);
}

void ARakisGameMode::StartPlay()
{
	Super::StartPlay();

	UWorld* World = GetWorld();
	if (!bAutoSpawnWorm || !World || !WormClass || WormSpawnTag.IsNone())
	{
		return;
	}
	TActorIterator<ARakisWorm> ExistingWorm(World);
	if (ExistingWorm)
	{
		return; // червь уже стоит на уровне
	}

	TArray<AActor*> SpawnPoints;
	UGameplayStatics::GetAllActorsWithTag(this, WormSpawnTag, SpawnPoints);
	if (SpawnPoints.Num() == 0 || !SpawnPoints[0])
	{
		return;
	}

	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	const FTransform SpawnTransform(FRotator(0.f, SpawnPoints[0]->GetActorRotation().Yaw, 0.f), SpawnPoints[0]->GetActorLocation());
	if (World->SpawnActor<ARakisWorm>(WormClass, SpawnTransform, Params))
	{
		UE_LOG(LogRakis, Log, TEXT("RakisGameMode: spawned worm at %s"), *SpawnTransform.GetLocation().ToString());
	}
}
