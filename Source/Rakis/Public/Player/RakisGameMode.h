#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "RakisGameMode.generated.h"

class ARakisWorm;

/**
 * Режим игры среза: Pawn = ARakisCharacter, PC = ARakisPlayerController,
 * HUD = ARakisHUD (класс другого агента, ищется по пути /Script/Rakis.RakisHUD без include).
 * Если на уровне есть точка с тегом Rakis.Worm.Spawn, а червя нет — спавнит ARakisWorm.
 */
UCLASS()
class RAKIS_API ARakisGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	ARakisGameMode();

	virtual void InitGame(const FString& MapName, const FString& Options, FString& ErrorMessage) override;
	virtual void StartPlay() override;

protected:
	/** Путь к классу HUD. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Game")
	FString HUDClassPath = TEXT("/Script/Rakis.RakisHUD");

	/** Автоспавн червя у точки с тегом WormSpawnTag. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Game")
	bool bAutoSpawnWorm = true;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Game")
	FName WormSpawnTag = TEXT("Rakis.Worm.Spawn");

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Game")
	TSubclassOf<ARakisWorm> WormClass;

private:
	void ResolveHUDClass();
};
