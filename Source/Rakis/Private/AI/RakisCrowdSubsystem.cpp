#include "AI/RakisCrowdSubsystem.h"

#include "Rakis.h"
#include "AI/RakisCitizen.h"
#include "AI/RakisCompanion.h"
#include "Audio/RakisAudioDirector.h"
#include "Core/RakisSettings.h"
#include "World/RakisZoneSubsystem.h"

#include "Engine/DataTable.h"
#include "Engine/Engine.h"
#include "Engine/Level.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/Pawn.h"
#include "HAL/IConsoleManager.h"
#include "Kismet/GameplayStatics.h"
#include "TimerManager.h"

namespace RakisCrowdPrivate
{
	static const FString SmartObjectPrefix(TEXT("Rakis.SmartObject."));
	static const FString CompanionPrefix(TEXT("Rakis.Companion."));
	static const FName TagHallGather(TEXT("Rakis.HallGather"));

	static TAutoConsoleVariable<int32> CVarAutoRitual(
		TEXT("Rakis.Crowd.AutoRitual"), 1,
		TEXT("1 — запускать ритуал автоматически при входе в B3 или через N сек в B2 (docs/06 §1.3)."));

	static TAutoConsoleVariable<int32> CVarAutoSpawnCompanions(
		TEXT("Rakis.Companions.AutoSpawn"), 1,
		TEXT("1 — спавнить ARakisCompanion у маркеров Rakis.Companion.<Id>, если такого спутника нет на уровне."));

	/** Алиасы имён из CSV к типам точек контракта (§2.4). */
	static FName ResolveSpotAlias(const FString& Raw)
	{
		const FString T = Raw.TrimStartAndEnd();
		if (T.Equals(TEXT("Prayer"), ESearchCase::IgnoreCase)) { return TEXT("PrayerMat"); }
		if (T.Equals(TEXT("Water"), ESearchCase::IgnoreCase)) { return TEXT("WaterJar"); }
		if (T.Equals(TEXT("Repair"), ESearchCase::IgnoreCase)) { return TEXT("StillsuitRepair"); }
		if (T.Equals(TEXT("Market"), ESearchCase::IgnoreCase)) { return TEXT("Stall"); }
		return FName(*T);
	}

	static FRakisCrowdArchetypeRow MakeArchetype(const TCHAR* Ru, const TCHAR* En, float Speed, const TCHAR* Tags,
		const TCHAR* Palette, float Weight, const TCHAR* Age)
	{
		FRakisCrowdArchetypeRow R;
		R.DisplayName_RU = Ru;
		R.DisplayName_EN = En;
		R.WalkSpeed = Speed;
		R.SmartObjectTags = Tags;
		R.ClothPalette = Palette;
		R.SpawnWeight = Weight;
		R.AgeGroup = FName(Age);
		return R;
	}
}

static void RakisStartRitualCommand(const TArray<FString>& Args, UWorld* World)
{
	if (URakisCrowdSubsystem* Crowd = World ? World->GetSubsystem<URakisCrowdSubsystem>() : nullptr)
	{
		Crowd->StartRitual();
	}
}

static FAutoConsoleCommandWithWorldAndArgs GRakisStartRitualCmd(
	TEXT("Rakis.Crowd.StartRitual"),
	TEXT("Отправить толпу сиетча к точкам Rakis.HallGather."),
	FConsoleCommandWithWorldAndArgsDelegate::CreateStatic(&RakisStartRitualCommand));

// ---------------------------------------------------------------------------------------------

URakisCrowdSubsystem* URakisCrowdSubsystem::Get(const UObject* WorldContextObject)
{
	const UWorld* World = GEngine ? GEngine->GetWorldFromContextObject(WorldContextObject, EGetWorldErrorMode::ReturnNull) : nullptr;
	return World ? World->GetSubsystem<URakisCrowdSubsystem>() : nullptr;
}

bool URakisCrowdSubsystem::DoesSupportWorldType(const EWorldType::Type WorldType) const
{
	return WorldType == EWorldType::Game || WorldType == EWorldType::PIE;
}

void URakisCrowdSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	BuildBuiltInArchetypes();
	LevelAddedHandle = FWorldDelegates::LevelAddedToWorld.AddUObject(this, &URakisCrowdSubsystem::HandleLevelAddedToWorld);
}

void URakisCrowdSubsystem::Deinitialize()
{
	FWorldDelegates::LevelAddedToWorld.Remove(LevelAddedHandle);
	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().ClearTimer(ConversationTimer);
		World->GetTimerManager().ClearTimer(AutoRitualTimer);
	}
	Citizens.Reset();
	SpotsByType.Reset();
	SpotTypes.Reset();
	SpotUsers.Reset();
	Talking.Reset();
	ArchetypeTable = nullptr;
	Super::Deinitialize();
}

void URakisCrowdSubsystem::OnWorldBeginPlay(UWorld& InWorld)
{
	Super::OnWorldBeginPlay(InWorld);

	LoadArchetypes();
	bSpotCacheDirty = true;

	const float Period = 1.f / FMath::Max(ConversationUpdateHz, 0.5f);
	InWorld.GetTimerManager().SetTimer(ConversationTimer, FTimerDelegate::CreateUObject(this, &URakisCrowdSubsystem::UpdateConversations), Period, true, Period);

	if (URakisZoneSubsystem* Zones = InWorld.GetSubsystem<URakisZoneSubsystem>())
	{
		Zones->OnZoneChanged.AddUniqueDynamic(this, &URakisCrowdSubsystem::HandleZoneChanged);
	}

	SpawnMissingCompanions();
}

void URakisCrowdSubsystem::HandleLevelAddedToWorld(ULevel* InLevel, UWorld* InWorld)
{
	if (InWorld == GetWorld())
	{
		bSpotCacheDirty = true;
		if (InWorld->HasBegunPlay())
		{
			SpawnMissingCompanions();
		}
	}
}

// ---------------------------------------------------------------------------------------------
// Архетипы
// ---------------------------------------------------------------------------------------------

void URakisCrowdSubsystem::BuildBuiltInArchetypes()
{
	using RakisCrowdPrivate::MakeArchetype;
	BuiltInArchetypes.Reset();
	// Палитры — выгоревшие охры, пыльный индиго, «синие» акценты (GDD §2), без чистых цветов.
	BuiltInArchetypes.Add(TEXT("Trader"),       MakeArchetype(TEXT("Торговец"),      TEXT("Trader"),        115.f, TEXT("Stall;Bench"),            TEXT("#6B4F36;#8C6B45;#2C3E57"), 1.2f, TEXT("Adult")));
	BuiltInArchetypes.Add(TEXT("Artisan"),      MakeArchetype(TEXT("Ремесленник"),   TEXT("Artisan"),       120.f, TEXT("StillsuitRepair;Bench"),  TEXT("#5A4A3A;#7A6A55;#3B3A36"), 1.0f, TEXT("Adult")));
	BuiltInArchetypes.Add(TEXT("WaterCarrier"), MakeArchetype(TEXT("Водонос"),       TEXT("Water Carrier"), 110.f, TEXT("WaterJar;Stall"),         TEXT("#2C3E57;#4A5D73;#B89A6A"), 0.8f, TEXT("Adult")));
	BuiltInArchetypes.Add(TEXT("Child"),        MakeArchetype(TEXT("Ребёнок"),       TEXT("Child"),         150.f, TEXT("Bench;Niche"),            TEXT("#B89A6A;#9C7A50;#4A5D73"), 0.9f, TEXT("Child")));
	BuiltInArchetypes.Add(TEXT("Guard"),        MakeArchetype(TEXT("Страж"),         TEXT("Guard"),         125.f, TEXT("Bench"),                  TEXT("#3B3A36;#4E4636;#2C3E57"), 0.6f, TEXT("Adult")));
	BuiltInArchetypes.Add(TEXT("Pilgrim"),      MakeArchetype(TEXT("Паломник"),      TEXT("Pilgrim"),       100.f, TEXT("PrayerMat;Niche"),        TEXT("#C9B48E;#A68F6A;#6B4F36"), 1.0f, TEXT("Adult")));
	BuiltInArchetypes.Add(TEXT("Elder"),        MakeArchetype(TEXT("Старик"),        TEXT("Elder"),          80.f, TEXT("Bench;PrayerMat"),        TEXT("#8C7B66;#5A4A3A;#D2C2A0"), 0.8f, TEXT("Elder")));
	BuiltInArchetypes.Add(TEXT("Weaver"),       MakeArchetype(TEXT("Ткачиха"),       TEXT("Weaver"),        110.f, TEXT("Loom;Bench"),             TEXT("#7A3E2E;#2C3E57;#B89A6A"), 1.0f, TEXT("Adult")));
}

void URakisCrowdSubsystem::LoadArchetypes()
{
	if (ArchetypeTable)
	{
		return;
	}
	const URakisSettings* Settings = URakisSettings::Get();
	if (Settings && !Settings->CrowdArchetypes.IsNull())
	{
		ArchetypeTable = Settings->CrowdArchetypes.LoadSynchronous();
	}
	if (ArchetypeTable && ArchetypeTable->GetRowStruct() != FRakisCrowdArchetypeRow::StaticStruct())
	{
		UE_LOG(LogRakis, Warning, TEXT("Crowd: %s имеет неверную структуру строк."), *ArchetypeTable->GetName());
		ArchetypeTable = nullptr;
	}
	if (!ArchetypeTable && !bWarnedNoTable)
	{
		bWarnedNoTable = true;
		UE_LOG(LogRakis, Warning, TEXT("Crowd: DT_CrowdArchetypes не найден — используются 8 встроенных архетипов."));
	}
}

const FRakisCrowdArchetypeRow* URakisCrowdSubsystem::FindArchetype(FName Archetype) const
{
	if (ArchetypeTable)
	{
		if (const FRakisCrowdArchetypeRow* Row = ArchetypeTable->FindRow<FRakisCrowdArchetypeRow>(Archetype, TEXT("RakisCrowd"), false))
		{
			return Row;
		}
	}
	return BuiltInArchetypes.Find(Archetype);
}

void URakisCrowdSubsystem::GetArchetypeWeights(TArray<FName>& OutNames, TArray<float>& OutWeights) const
{
	OutNames.Reset();
	OutWeights.Reset();
	if (ArchetypeTable && ArchetypeTable->GetRowMap().Num() > 0)
	{
		for (const FName& Name : ArchetypeTable->GetRowNames())
		{
			if (const FRakisCrowdArchetypeRow* Row = ArchetypeTable->FindRow<FRakisCrowdArchetypeRow>(Name, TEXT("RakisCrowd"), false))
			{
				OutNames.Add(Name);
				OutWeights.Add(FMath::Max(0.f, Row->SpawnWeight));
			}
		}
		return;
	}
	// Встроенные — в фиксированном порядке (TMap сохраняет порядок вставки, пока нет удалений).
	for (const TPair<FName, FRakisCrowdArchetypeRow>& Pair : BuiltInArchetypes)
	{
		OutNames.Add(Pair.Key);
		OutWeights.Add(Pair.Value.SpawnWeight);
	}
}

TArray<FName> URakisCrowdSubsystem::GetArchetypeSpotTypes(FName Archetype) const
{
	TArray<FName> Types;
	if (const FRakisCrowdArchetypeRow* Row = FindArchetype(Archetype))
	{
		TArray<FString> Parts;
		Row->SmartObjectTags.ParseIntoArray(Parts, TEXT(";"), true);
		for (const FString& Part : Parts)
		{
			const FName Type = RakisCrowdPrivate::ResolveSpotAlias(Part);
			if (!Type.IsNone())
			{
				Types.AddUnique(Type);
			}
		}
	}
	return Types;
}

// ---------------------------------------------------------------------------------------------
// Горожане и точки
// ---------------------------------------------------------------------------------------------

void URakisCrowdSubsystem::RegisterCitizen(ARakisCitizen* Citizen)
{
	if (!Citizen)
	{
		return;
	}
	Citizens.AddUnique(Citizen);

	// Опоздавшие к ритуалу (стриминг) сразу идут в зал.
	if (bRitualStarted)
	{
		const AActor* Point = nullptr;
		TArray<AActor*> Gather;
		UGameplayStatics::GetAllActorsWithTag(this, RakisCrowdPrivate::TagHallGather, Gather);
		if (Gather.Num() > 0)
		{
			Point = Gather[(Citizens.Num() - 1) % Gather.Num()];
			const FVector Target = Point->GetActorLocation();
			TWeakObjectPtr<ARakisCitizen> Weak(Citizen);
			FTimerHandle Handle;
			GetWorld()->GetTimerManager().SetTimer(Handle, FTimerDelegate::CreateWeakLambda(Citizen, [Weak, Target]()
			{
				if (ARakisCitizen* C = Weak.Get())
				{
					C->BeginRitualFlow(Target);
				}
			}), 0.5f, false);
		}
	}
}

void URakisCrowdSubsystem::UnregisterCitizen(ARakisCitizen* Citizen)
{
	Citizens.Remove(Citizen);
	Talking.Remove(Citizen);
	for (TPair<TWeakObjectPtr<AActor>, TArray<TWeakObjectPtr<ARakisCitizen>>>& Pair : SpotUsers)
	{
		Pair.Value.Remove(Citizen);
	}
}

int32 URakisCrowdSubsystem::GetSpotCapacity(FName Type)
{
	static const FName Bench(TEXT("Bench"));
	static const FName Stall(TEXT("Stall"));
	static const FName WaterJar(TEXT("WaterJar"));
	if (Type == Bench) { return 3; }
	if (Type == Stall || Type == WaterJar) { return 2; }
	return 1;
}

void URakisCrowdSubsystem::RebuildSpotCache()
{
	bSpotCacheDirty = false;
	SpotsByType.Reset();
	SpotTypes.Reset();

	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}
	int32 Count = 0;
	for (TActorIterator<AActor> It(World); It; ++It)
	{
		AActor* Actor = *It;
		if (!IsValid(Actor))
		{
			continue;
		}
		for (const FName& Tag : Actor->Tags)
		{
			const FString TagStr = Tag.ToString();
			if (TagStr.StartsWith(RakisCrowdPrivate::SmartObjectPrefix))
			{
				const FName Type(*TagStr.RightChop(RakisCrowdPrivate::SmartObjectPrefix.Len()));
				SpotsByType.FindOrAdd(Type).Add(Actor);
				SpotTypes.Add(Actor, Type);
				++Count;
				break;
			}
		}
	}
	// Удалить пользователей точек, которые исчезли.
	for (auto It = SpotUsers.CreateIterator(); It; ++It)
	{
		if (!It->Key.IsValid())
		{
			It.RemoveCurrent();
		}
	}
	UE_LOG(LogRakis, Log, TEXT("Crowd: точек Smart Object: %d (типов %d)"), Count, SpotsByType.Num());
}

int32 URakisCrowdSubsystem::GetSpotOccupancy(const AActor* Spot) const
{
	if (const TArray<TWeakObjectPtr<ARakisCitizen>>* Users = SpotUsers.Find(const_cast<AActor*>(Spot)))
	{
		int32 N = 0;
		for (const TWeakObjectPtr<ARakisCitizen>& U : *Users)
		{
			N += U.IsValid() ? 1 : 0;
		}
		return N;
	}
	return 0;
}

AActor* URakisCrowdSubsystem::ReserveSpot(ARakisCitizen* User, const TArray<FName>& Types, const FVector& Near, float MaxDistance, FRandomStream& Rng, FName& OutType)
{
	if (bSpotCacheDirty)
	{
		RebuildSpotCache();
	}

	struct FCandidate { AActor* Spot; FName Type; float Weight; };
	TArray<FCandidate> Candidates;
	float TotalWeight = 0.f;
	const float MaxDistSq = FMath::Square(MaxDistance);

	for (const FName& Type : Types)
	{
		const TArray<TWeakObjectPtr<AActor>>* Spots = SpotsByType.Find(Type);
		if (!Spots)
		{
			continue;
		}
		const int32 Capacity = GetSpotCapacity(Type);
		for (const TWeakObjectPtr<AActor>& Weak : *Spots)
		{
			AActor* Spot = Weak.Get();
			if (!Spot)
			{
				continue;
			}
			const float DistSq = FVector::DistSquared(Spot->GetActorLocation(), Near);
			if (DistSq > MaxDistSq || GetSpotOccupancy(Spot) >= Capacity)
			{
				continue;
			}
			// Ближние точки вероятнее, но не всегда — толпа перемешивается.
			const float W = 1.f / (1.f + FMath::Sqrt(DistSq) / 1000.f);
			Candidates.Add({ Spot, Type, W });
			TotalWeight += W;
		}
	}
	if (Candidates.Num() == 0 || TotalWeight <= 0.f)
	{
		return nullptr;
	}

	float Pick = Rng.FRandRange(0.f, TotalWeight);
	const FCandidate* Chosen = &Candidates.Last();
	for (const FCandidate& C : Candidates)
	{
		Pick -= C.Weight;
		if (Pick <= 0.f)
		{
			Chosen = &C;
			break;
		}
	}
	SpotUsers.FindOrAdd(Chosen->Spot).AddUnique(User);
	OutType = Chosen->Type;
	return Chosen->Spot;
}

void URakisCrowdSubsystem::ReleaseSpot(ARakisCitizen* User, AActor* Spot)
{
	if (!Spot)
	{
		return;
	}
	if (TArray<TWeakObjectPtr<ARakisCitizen>>* Users = SpotUsers.Find(Spot))
	{
		Users->Remove(User);
		Users->RemoveAll([](const TWeakObjectPtr<ARakisCitizen>& W) { return !W.IsValid(); });
	}
}

// ---------------------------------------------------------------------------------------------
// Разговоры и лай
// ---------------------------------------------------------------------------------------------

void URakisCrowdSubsystem::SetTalking(ARakisCitizen* Citizen, bool bTalking)
{
	if (!Citizen)
	{
		return;
	}
	if (bTalking)
	{
		Talking.Add(Citizen);
	}
	else
	{
		Talking.Remove(Citizen);
	}
}

bool URakisCrowdSubsystem::TryAcquireBarkSlot()
{
	const UWorld* World = GetWorld();
	const float Now = World ? World->GetTimeSeconds() : 0.f;
	if (Now - LastBarkTime < MinGlobalBarkInterval)
	{
		return false;
	}
	LastBarkTime = Now;
	return true;
}

void URakisCrowdSubsystem::UpdateConversations()
{
	const APawn* Player = UGameplayStatics::GetPlayerPawn(this, 0);
	const UWorld* World = GetWorld();
	if (!Player || !World)
	{
		return;
	}
	const float Now = World->GetTimeSeconds();
	const FVector PlayerLoc = Player->GetActorLocation();

	// Группа разговора = точка, на которой стоят собеседники (или сам горожанин, если без точки).
	TMap<TWeakObjectPtr<AActor>, float> GroupDist;
	TMap<TWeakObjectPtr<AActor>, TArray<ARakisCitizen*>> GroupMembers;

	for (auto It = Talking.CreateIterator(); It; ++It)
	{
		ARakisCitizen* C = It->Get();
		if (!C)
		{
			It.RemoveCurrent();
			continue;
		}
		AActor* Group = C->GetCurrentSpot() ? C->GetCurrentSpot() : C;
		const float D = FVector::Dist(C->GetActorLocation(), PlayerLoc);
		float& MinD = GroupDist.FindOrAdd(Group, TNumericLimits<float>::Max());
		MinD = FMath::Min(MinD, D);
		GroupMembers.FindOrAdd(Group).Add(C);
	}

	for (const TPair<TWeakObjectPtr<AActor>, float>& Pair : GroupDist)
	{
		const TWeakObjectPtr<AActor>& Group = Pair.Key;
		const float D = Pair.Value;
		const TArray<ARakisCitizen*>& Members = GroupMembers.FindChecked(Group);

		if (SilencedGroups.Contains(Group))
		{
			if (D > ResumeRadius)
			{
				const float* Since = GroupClearSince.Find(Group);
				if (!Since)
				{
					GroupClearSince.Add(Group, Now);
				}
				else if (Now - *Since >= ResumeDelay)
				{
					for (ARakisCitizen* M : Members) { M->SetConversationSilenced(false); }
					SilencedGroups.Remove(Group);
					GroupClearSince.Remove(Group);
				}
			}
			else
			{
				GroupClearSince.Remove(Group);
			}
		}
		else if (D < SilenceRadius)
		{
			for (ARakisCitizen* M : Members) { M->SetConversationSilenced(true); }
			SilencedGroups.Add(Group);
			GroupClearSince.Remove(Group);

			// Звук «разговор стих» (DT_AudioEvents Trigger "Crowd:PlayerNear"), не чаще HushSoundCooldown.
			if (Now >= NextHushSoundTime && Group.IsValid())
			{
				NextHushSoundTime = Now + HushSoundCooldown;
				if (URakisAudioDirector* Audio = URakisAudioDirector::Get(this))
				{
					Audio->PostEventByTrigger(TEXT("Crowd:PlayerNear"), Group->GetActorLocation());
				}
			}
		}
	}

	// Уборка устаревших групп.
	for (auto It = SilencedGroups.CreateIterator(); It; ++It)
	{
		if (!It->IsValid() || !GroupDist.Contains(*It))
		{
			GroupClearSince.Remove(*It);
			It.RemoveCurrent();
		}
	}
}

// ---------------------------------------------------------------------------------------------
// Ритуал
// ---------------------------------------------------------------------------------------------

bool URakisCrowdSubsystem::GetHallCentre(FVector& OutCentre) const
{
	TArray<AActor*> Gather;
	UGameplayStatics::GetAllActorsWithTag(this, RakisCrowdPrivate::TagHallGather, Gather);
	if (Gather.Num() == 0)
	{
		return false;
	}
	FVector Sum = FVector::ZeroVector;
	for (const AActor* A : Gather)
	{
		Sum += A->GetActorLocation();
	}
	OutCentre = Sum / Gather.Num();
	return true;
}

void URakisCrowdSubsystem::StartRitual()
{
	if (bRitualStarted)
	{
		return;
	}
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}

	TArray<AActor*> Gather;
	UGameplayStatics::GetAllActorsWithTag(this, RakisCrowdPrivate::TagHallGather, Gather);
	if (Gather.Num() == 0)
	{
		if (!bWarnedNoGather)
		{
			bWarnedNoGather = true;
			UE_LOG(LogRakis, Warning, TEXT("Crowd: нет точек Rakis.HallGather — ритуал не запущен (повторится при следующем вызове)."));
		}
		return;
	}
	// Детерминированный порядок точек.
	Gather.Sort([](const AActor& A, const AActor& B) { return A.GetName() < B.GetName(); });

	FVector Centre = FVector::ZeroVector;
	for (const AActor* A : Gather) { Centre += A->GetActorLocation(); }
	Centre /= Gather.Num();

	bRitualStarted = true;
	OnRitualStarted.Broadcast();

	// Хоровой гул толпы в зале (DT_AudioEvents Trigger "CrowdRitual").
	if (URakisAudioDirector* Audio = URakisAudioDirector::Get(this))
	{
		Audio->PostEventByTrigger(TEXT("CrowdRitual"), Centre);
	}

	TArray<ARakisCitizen*> Valid;
	for (const TWeakObjectPtr<ARakisCitizen>& Weak : Citizens)
	{
		if (ARakisCitizen* C = Weak.Get())
		{
			Valid.Add(C);
		}
	}
	// Ближние к залу трогаются первыми — поток выглядит как «вытягивание» толпы.
	Valid.Sort([&Centre](const ARakisCitizen& A, const ARakisCitizen& B)
	{
		return FVector::DistSquared(A.GetActorLocation(), Centre) < FVector::DistSquared(B.GetActorLocation(), Centre);
	});

	FRandomStream Rng(0x52495455); // "RITU"
	const int32 NumPoints = Gather.Num();
	for (int32 i = 0; i < Valid.Num(); ++i)
	{
		const int32 Ring = i / NumPoints;
		FVector Target = Gather[i % NumPoints]->GetActorLocation();
		if (Ring > 0)
		{
			// Кольца вокруг точки по «золотому углу», чтобы не стояли в одной точке.
			const float Angle = FMath::DegreesToRadians(137.508f * static_cast<float>(i));
			Target += FVector(FMath::Cos(Angle), FMath::Sin(Angle), 0.f) * GatherRingSpacing * Ring;
		}
		const float Delay = RitualStartDelay + RitualStaggerStep * i + Rng.FRandRange(0.f, RitualStaggerJitter);

		ARakisCitizen* Citizen = Valid[i];
		TWeakObjectPtr<ARakisCitizen> Weak(Citizen);
		FTimerHandle Handle;
		World->GetTimerManager().SetTimer(Handle, FTimerDelegate::CreateWeakLambda(Citizen, [Weak, Target]()
		{
			if (ARakisCitizen* C = Weak.Get())
			{
				C->BeginRitualFlow(Target);
			}
		}), FMath::Max(Delay, 0.01f), false);
	}

	UE_LOG(LogRakis, Log, TEXT("Crowd: ритуал — %d горожан к %d точкам сбора."), Valid.Num(), NumPoints);
}

void URakisCrowdSubsystem::HandleZoneChanged(ERakisZone OldZone, ERakisZone NewZone)
{
	if (bRitualStarted || RakisCrowdPrivate::CVarAutoRitual.GetValueOnGameThread() == 0)
	{
		return;
	}
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}
	if (NewZone == ERakisZone::B3_Passages || NewZone == ERakisZone::B4_Cistern || NewZone == ERakisZone::B5_Hall)
	{
		StartRitual();
	}
	else if (NewZone == ERakisZone::B2_Gallery && !World->GetTimerManager().IsTimerActive(AutoRitualTimer))
	{
		World->GetTimerManager().SetTimer(AutoRitualTimer, FTimerDelegate::CreateUObject(this, &URakisCrowdSubsystem::TickAutoRitual), AutoRitualGallerySeconds, false);
	}
}

void URakisCrowdSubsystem::TickAutoRitual()
{
	const URakisZoneSubsystem* Zones = URakisZoneSubsystem::Get(this);
	const ERakisZone Zone = Zones ? Zones->GetPlayerZone() : ERakisZone::None;
	if (Zone == ERakisZone::B2_Gallery || Zone == ERakisZone::B3_Passages || Zone == ERakisZone::B4_Cistern || Zone == ERakisZone::B5_Hall)
	{
		StartRitual();
	}
}

// ---------------------------------------------------------------------------------------------
// Спутники
// ---------------------------------------------------------------------------------------------

void URakisCrowdSubsystem::SpawnMissingCompanions()
{
	UWorld* World = GetWorld();
	if (!World || RakisCrowdPrivate::CVarAutoSpawnCompanions.GetValueOnGameThread() == 0)
	{
		return;
	}

	TSet<FName> Existing;
	for (TActorIterator<ARakisCompanion> It(World); It; ++It)
	{
		Existing.Add(It->CompanionId);
	}

	UClass* SpawnClass = ARakisCompanion::StaticClass();
	if (!CompanionClass.IsNull())
	{
		if (UClass* Loaded = CompanionClass.LoadSynchronous())
		{
			SpawnClass = Loaded;
		}
		else
		{
			UE_LOG(LogRakis, Warning, TEXT("Crowd: CompanionClass %s не загрузился — используется ARakisCompanion."), *CompanionClass.ToString());
		}
	}

	for (TActorIterator<AActor> It(World); It; ++It)
	{
		const AActor* Marker = *It;
		if (!IsValid(Marker) || Marker->IsA<ARakisCompanion>())
		{
			continue;
		}
		for (const FName& Tag : Marker->Tags)
		{
			const FString TagStr = Tag.ToString();
			if (!TagStr.StartsWith(RakisCrowdPrivate::CompanionPrefix))
			{
				continue;
			}
			const FName Id(*TagStr.RightChop(RakisCrowdPrivate::CompanionPrefix.Len()));
			if (Id.IsNone() || Existing.Contains(Id))
			{
				continue;
			}

			FTransform SpawnTM(FRotator(0.f, Marker->GetActorRotation().Yaw, 0.f), Marker->GetActorLocation() + FVector(0.f, 0.f, 95.f));
			FActorSpawnParameters Params;
			Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn;
			Params.bDeferConstruction = true;
			// Спутники живут в постоянном уровне — переживают выгрузку пустыни.
			Params.OverrideLevel = World->PersistentLevel;
			if (ARakisCompanion* Companion = World->SpawnActor<ARakisCompanion>(SpawnClass, SpawnTM, Params))
			{
				Companion->CompanionId = Id;
				Companion->FinishSpawning(SpawnTM);
				Existing.Add(Id);
				UE_LOG(LogRakis, Log, TEXT("Crowd: спутник %s создан у %s"), *Id.ToString(), *Marker->GetName());
			}
		}
	}
}
