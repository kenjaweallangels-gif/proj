#include "AI/RakisCrowdSpawner.h"

#include "Rakis.h"
#include "AI/RakisCitizen.h"
#include "AI/RakisCrowdSubsystem.h"

#include "Components/BillboardComponent.h"
#include "Components/CapsuleComponent.h"
#include "Components/SceneComponent.h"
#include "Engine/World.h"
#include "Kismet/GameplayStatics.h"
#include "TimerManager.h"

ARakisCrowdSpawner::ARakisCrowdSpawner()
{
	PrimaryActorTick.bCanEverTick = false;
	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
#if WITH_EDITORONLY_DATA
	if (UBillboardComponent* Billboard = CreateEditorOnlyDefaultSubobject<UBillboardComponent>(TEXT("Billboard")))
	{
		Billboard->SetupAttachment(RootComponent);
	}
#endif
}

void ARakisCrowdSpawner::BeginPlay()
{
	Super::BeginPlay();
	if (bSpawnOnBeginPlay)
	{
		SpawnCrowd();
	}
}

void ARakisCrowdSpawner::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	GetWorldTimerManager().ClearTimer(BatchTimer);
	// При выгрузке уровня горожане уйдут вместе с ним; при уничтожении спавнера — убираем сами.
	if (EndPlayReason == EEndPlayReason::Destroyed)
	{
		DespawnCrowd();
	}
	Super::EndPlay(EndPlayReason);
}

int32 ARakisCrowdSpawner::GetSpawnedCount() const
{
	int32 N = 0;
	for (const TWeakObjectPtr<ARakisCitizen>& W : Spawned)
	{
		N += W.IsValid() ? 1 : 0;
	}
	return N;
}

void ARakisCrowdSpawner::DespawnCrowd()
{
	GetWorldTimerManager().ClearTimer(BatchTimer);
	for (const TWeakObjectPtr<ARakisCitizen>& W : Spawned)
	{
		if (ARakisCitizen* C = W.Get())
		{
			C->Destroy();
		}
	}
	Spawned.Reset();
	Plan.Reset();
	PlanCursor = 0;
}

FVector ARakisCrowdSpawner::ProjectToGround(const FVector& Point, float HalfHeight) const
{
	FHitResult Hit;
	FCollisionQueryParams Params(SCENE_QUERY_STAT(RakisCrowdSpawnGround), false, this);
	const FVector Start = Point + FVector(0.f, 0.f, 200.f);
	const FVector End = Point - FVector(0.f, 0.f, 1000.f);
	if (GetWorld()->LineTraceSingleByChannel(Hit, Start, End, ECC_Visibility, Params))
	{
		return Hit.ImpactPoint + FVector(0.f, 0.f, HalfHeight + 2.f);
	}
	return Point + FVector(0.f, 0.f, HalfHeight);
}

void ARakisCrowdSpawner::BuildPlan()
{
	Plan.Reset();
	PlanCursor = 0;

	URakisCrowdSubsystem* Crowd = URakisCrowdSubsystem::Get(this);
	TArray<FName> Names;
	TArray<float> Weights;
	if (Crowd)
	{
		Crowd->GetArchetypeWeights(Names, Weights);
	}
	float TotalWeight = 0.f;
	for (float W : Weights) { TotalWeight += W; }
	if (Names.Num() == 0 || TotalWeight <= 0.f)
	{
		UE_LOG(LogRakis, Warning, TEXT("CrowdSpawner %s: нет архетипов — толпа не создана."), *GetName());
		return;
	}

	// Точки: общие и по архетипам (детерминированный порядок — по имени актора).
	TArray<AActor*> Generic;
	UGameplayStatics::GetAllActorsWithTag(this, SpawnTag, Generic);
	Generic.Sort([](const AActor& A, const AActor& B) { return A.GetName() < B.GetName(); });

	TMap<FName, TArray<AActor*>> Specific;
	for (const FName& Name : Names)
	{
		TArray<AActor*> Points;
		UGameplayStatics::GetAllActorsWithTag(this, FName(*FString::Printf(TEXT("%s.%s"), *SpawnTag.ToString(), *Name.ToString())), Points);
		if (Points.Num() > 0)
		{
			Points.Sort([](const AActor& A, const AActor& B) { return A.GetName() < B.GetName(); });
			Specific.Add(Name, MoveTemp(Points));
		}
	}
	if (Generic.Num() == 0 && Specific.Num() == 0)
	{
		UE_LOG(LogRakis, Warning, TEXT("CrowdSpawner %s: нет точек %s — спавн вокруг спавнера."), *GetName(), *SpawnTag.ToString());
	}

	TSubclassOf<ARakisCitizen> Class = CitizenClass ? CitizenClass : TSubclassOf<ARakisCitizen>(ARakisCitizen::StaticClass());
	const ARakisCitizen* CDO = Class->GetDefaultObject<ARakisCitizen>();
	const float HalfHeight = CDO && CDO->GetCapsuleComponent() ? CDO->GetCapsuleComponent()->GetScaledCapsuleHalfHeight() : 90.f;

	FRandomStream Rng(Seed);
	for (int32 i = 0; i < Count; ++i)
	{
		// Архетип по весу.
		float Pick = Rng.FRandRange(0.f, TotalWeight);
		int32 ArchIndex = Names.Num() - 1;
		for (int32 k = 0; k < Names.Num(); ++k)
		{
			Pick -= Weights[k];
			if (Pick <= 0.f)
			{
				ArchIndex = k;
				break;
			}
		}
		const FName Arch = Names[ArchIndex];

		// Точка.
		FVector Base = GetActorLocation();
		const TArray<AActor*>* Own = Specific.Find(Arch);
		if (Own && (Generic.Num() == 0 || Rng.FRand() < SpecificPointBias))
		{
			Base = (*Own)[Rng.RandRange(0, Own->Num() - 1)]->GetActorLocation();
		}
		else if (Generic.Num() > 0)
		{
			Base = Generic[Rng.RandRange(0, Generic.Num() - 1)]->GetActorLocation();
		}

		const float Angle = Rng.FRandRange(0.f, 2.f * PI);
		const float Radius = FMath::Sqrt(Rng.FRand()) * ScatterRadius;
		const FVector Scattered = Base + FVector(FMath::Cos(Angle), FMath::Sin(Angle), 0.f) * Radius;

		FPlannedCitizen Entry;
		Entry.Archetype = Arch;
		Entry.Transform = FTransform(FRotator(0.f, Rng.FRandRange(-180.f, 180.f), 0.f), ProjectToGround(Scattered, HalfHeight));
		Entry.Seed = Seed * 7919 + i * 104729;
		Plan.Add(Entry);
	}
}

void ARakisCrowdSpawner::SpawnCrowd()
{
	if (Plan.Num() > 0 && PlanCursor < Plan.Num())
	{
		return; // уже идёт
	}
	BuildPlan();
	if (Plan.Num() == 0)
	{
		return;
	}
	UE_LOG(LogRakis, Log, TEXT("CrowdSpawner %s: спавн %d горожан (seed %d)."), *GetName(), Plan.Num(), Seed);
	if (BatchInterval > 0.f)
	{
		GetWorldTimerManager().SetTimer(BatchTimer, this, &ARakisCrowdSpawner::SpawnBatch, BatchInterval, true, 0.f);
	}
	else
	{
		while (PlanCursor < Plan.Num())
		{
			SpawnBatch();
		}
	}
}

void ARakisCrowdSpawner::SpawnBatch()
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}
	UClass* Class = CitizenClass ? CitizenClass.Get() : ARakisCitizen::StaticClass();

	const int32 End = FMath::Min(PlanCursor + FMath::Max(SpawnPerBatch, 1), Plan.Num());
	for (; PlanCursor < End; ++PlanCursor)
	{
		const FPlannedCitizen& Entry = Plan[PlanCursor];

		FActorSpawnParameters Params;
		Params.Owner = this;
		Params.OverrideLevel = GetLevel(); // живут и выгружаются вместе с уровнем сиетча
		Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn;
		Params.bDeferConstruction = true;

		ARakisCitizen* Citizen = World->SpawnActor<ARakisCitizen>(Class, Entry.Transform, Params);
		if (!Citizen)
		{
			continue;
		}
		Citizen->InitCitizen(Entry.Archetype, Entry.Seed);
		Citizen->FinishSpawning(Entry.Transform);
		Spawned.Add(Citizen);
	}

	if (PlanCursor >= Plan.Num())
	{
		GetWorldTimerManager().ClearTimer(BatchTimer);
		UE_LOG(LogRakis, Log, TEXT("CrowdSpawner %s: готово, %d горожан."), *GetName(), GetSpawnedCount());
	}
}
