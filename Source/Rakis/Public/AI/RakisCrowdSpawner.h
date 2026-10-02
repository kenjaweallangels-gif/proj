#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "RakisCrowdSpawner.generated.h"

class ARakisCitizen;

/**
 * Спавнер толпы сиетча (контракт §2.2 AI/, GDD §4: 40–80 NPC, 8 архетипов).
 * Ставится в L_Rakis_Sietch: BeginPlay наступает, когда уровень сиетча подгружен и видим.
 * Архетип выбирается по SpawnWeight (DT_CrowdArchetypes), точка — Rakis.CrowdSpawn.<Archetype>
 * (с вероятностью SpecificPointBias) или общая Rakis.CrowdSpawn. Всё детерминировано по Seed.
 * Спавн растянут на несколько кадров (SpawnPerBatch), горожане живут в уровне спавнера.
 */
UCLASS()
class RAKIS_API ARakisCrowdSpawner : public AActor
{
	GENERATED_BODY()

public:
	ARakisCrowdSpawner();

	/** Сколько горожан создать. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Rakis|Crowd", meta = (ClampMin = "0", ClampMax = "200"))
	int32 Count = 60;

	/** Зерно — одинаковая толпа при каждом запуске. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Rakis|Crowd")
	int32 Seed = 1701;

	/** Класс горожанина (BP-наследник с AnimBP и одеждой). Пусто — ARakisCitizen. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Rakis|Crowd")
	TSubclassOf<ARakisCitizen> CitizenClass;

	/** Базовый тег точек спавна. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Rakis|Crowd")
	FName SpawnTag = TEXT("Rakis.CrowdSpawn");

	/** Вероятность взять точку своего архетипа (Rakis.CrowdSpawn.<Archetype>), если такие есть. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Rakis|Crowd", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float SpecificPointBias = 0.75f;

	/** Разброс вокруг точки, см. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Rakis|Crowd")
	float ScatterRadius = 180.f;

	/** Сколько горожан создавать за один шаг таймера. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Rakis|Crowd", meta = (ClampMin = "1"))
	int32 SpawnPerBatch = 6;

	/** Интервал между шагами спавна, сек. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Rakis|Crowd", meta = (ClampMin = "0.0"))
	float BatchInterval = 0.05f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Rakis|Crowd")
	bool bSpawnOnBeginPlay = true;

	UFUNCTION(BlueprintCallable, Category = "Rakis|Crowd")
	void SpawnCrowd();

	UFUNCTION(BlueprintCallable, Category = "Rakis|Crowd")
	void DespawnCrowd();

	UFUNCTION(BlueprintPure, Category = "Rakis|Crowd")
	int32 GetSpawnedCount() const;

protected:
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;

private:
	struct FPlannedCitizen
	{
		FName Archetype;
		FTransform Transform;
		int32 Seed = 0;
	};

	void BuildPlan();
	void SpawnBatch();
	FVector ProjectToGround(const FVector& Point, float HalfHeight) const;

	TArray<FPlannedCitizen> Plan;
	int32 PlanCursor = 0;
	FTimerHandle BatchTimer;
	TArray<TWeakObjectPtr<ARakisCitizen>> Spawned;
};
