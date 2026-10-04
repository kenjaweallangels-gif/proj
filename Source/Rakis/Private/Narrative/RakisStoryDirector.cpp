#include "Narrative/RakisStoryDirector.h"

#include "Rakis.h"
#include "Core/RakisSettings.h"
#include "Narrative/RakisDialogueSubsystem.h"
#include "UI/RakisHUD.h"

// API других ролей (контракт §2.2).
#include "AI/RakisCompanion.h"
#include "AI/RakisCrowdSubsystem.h"
#include "Audio/RakisAudioDirector.h"
#include "Interaction/RakisInteractionComponent.h"
#include "Noise/RakisNoiseComponent.h"
#include "Player/RakisCharacter.h"
#include "Weather/RakisWeatherSubsystem.h"
#include "World/RakisCinematicTrigger.h"
#include "World/RakisZoneSubsystem.h"
#include "Worm/RakisWorm.h"

#include "Camera/PlayerCameraManager.h"
#include "Components/CapsuleComponent.h"
#include "Engine/DataTable.h"
#include "Engine/Engine.h"
#include "Engine/HitResult.h"
#include "GameFramework/Character.h"
#include "GameFramework/Controller.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "GameFramework/PlayerController.h"
#include "HAL/IConsoleManager.h"
#include "Kismet/GameplayStatics.h"
#include "Math/RotationMatrix.h"
#include "UObject/SoftObjectPath.h"

namespace RakisStoryPrivate
{
	static const FName StoryTag(TEXT("Rakis.Story"));

	static const FName Action_PlayDialogue(TEXT("PlayDialogue"));
	static const FName Action_PlayCinematic(TEXT("PlayCinematic"));
	static const FName Action_SetWeather(TEXT("SetWeather"));
	static const FName Action_SetMusic(TEXT("SetMusic"));
	static const FName Action_TitleCard(TEXT("TitleCard"));
	static const FName Action_ForceWorm(TEXT("ForceWorm"));
	static const FName Action_CrowdRitual(TEXT("CrowdRitual"));
	static const FName Action_Hint(TEXT("Hint"));
	static const FName Action_FadeOut(TEXT("FadeOut"));
	static const FName Action_EndDemo(TEXT("EndDemo"));
	static const FName Action_Ellipsis(TEXT("Ellipsis"));

	/** Rakis.Story.Ellipsis 0|1 — склейки золотого пути (по умолчанию включены). Можно задать в DefaultEngine.ini [ConsoleVariables]. */
	static TAutoConsoleVariable<int32> CVarStoryEllipsis(
		TEXT("Rakis.Story.Ellipsis"), 1,
		TEXT("Склейки-эллипсисы золотого пути: 1 — включены (сценарий ~3:40), 0 — выключены (свободная игра 15–20 мин)."),
		ECVF_Default);

	/** Период проверки «золотого момента» склейки, с. */
	static constexpr float EllipsisPollSeconds = 0.25f;
	/** Появление/угасание титра-склейки (SRakisHUDRoot::CutCard), с. */
	static constexpr float CutCardFadeIn = 0.5f;
	static constexpr float CutCardFadeOut = 0.6f;

	template <typename TEnum>
	static FString EnumShortName(TEnum Value)
	{
		const UEnum* Enum = StaticEnum<TEnum>();
		return Enum ? Enum->GetNameStringByValue(static_cast<int64>(Value)) : FString();
	}

	template <typename TEnum>
	static bool ParseEnum(const FString& Text, TEnum& OutValue)
	{
		const UEnum* Enum = StaticEnum<TEnum>();
		if (!Enum)
		{
			return false;
		}
		const FString Trimmed = Text.TrimStartAndEnd();
		for (int32 Index = 0; Index < Enum->NumEnums(); ++Index)
		{
			if (Enum->GetNameStringByIndex(Index).Equals(Trimmed, ESearchCase::IgnoreCase))
			{
				OutValue = static_cast<TEnum>(Enum->GetValueByIndex(Index));
				return true;
			}
		}
		return false;
	}

	/** Встроенный сценарий (docs/01_scenario.md, docs/06_demo_contract.md §1.3). Реплики — во встроенном наборе URakisDialogueSubsystem. */
	struct FBuiltInBeat
	{
		const TCHAR* BeatID;
		int32 Order;
		const TCHAR* Trigger;
		const TCHAR* Action;
		const TCHAR* Param;
		float Delay;
	};

	static const FBuiltInBeat BuiltInBeats[] =
	{
		// A1 — гребень, рассвет
		{ TEXT("S_Start_Weather"),   0, TEXT("Start"),                 TEXT("SetWeather"),    TEXT("Dawn_Ridge,0"), 0.f },
		{ TEXT("S_Start_Music"),     1, TEXT("Start"),                 TEXT("SetMusic"),      TEXT("DesertCalm"), 0.f },
		{ TEXT("S_A1_Title"),        2, TEXT("Start"),                 TEXT("TitleCard"),     TEXT("Ракис. Гребень Шайтана. Рассвет|Rakis. Shaitan's Ridge. Dawn"), 3.f },
		{ TEXT("S_A1_Line"),         3, TEXT("Start"),                 TEXT("PlayDialogue"),  TEXT("A1_Ilva_01"), 11.f },
		{ TEXT("S_A1_Hint"),         4, TEXT("Beat:S_A1_Line"),        TEXT("Hint"),          TEXT("Удерживайте Alt (LB) — походка по песку. Сбивайте ритм.|Hold Alt (LB) to sand-walk. Break your rhythm."), 1.f },
		// A2 — открытый эрг, червь
		{ TEXT("S_A2_Weather"),     10, TEXT("ZoneEnter:A2_Erg"),      TEXT("SetWeather"),    TEXT("Morning_Erg,10"), 0.f },
		{ TEXT("S_A2_Music"),       11, TEXT("ZoneEnter:A2_Erg"),      TEXT("SetMusic"),      TEXT("DesertDrone"), 0.f },
		{ TEXT("S_A2_Title"),       12, TEXT("ZoneEnter:A2_Erg"),      TEXT("TitleCard"),     TEXT("Открытый эрг|The Open Erg"), 1.f },
		{ TEXT("S_A2_Line"),        13, TEXT("ZoneEnter:A2_Erg"),      TEXT("PlayDialogue"),  TEXT("A2_Rayn_01"), 12.f },
		{ TEXT("S_A2_Tension"),     14, TEXT("ZoneEnter:A2_Erg"),      TEXT("SetWeather"),    TEXT("Worm_Tension,6"), 40.f },
		{ TEXT("S_A2_ThreatMusic"), 15, TEXT("ZoneEnter:A2_Erg"),      TEXT("SetMusic"),      TEXT("WormThreat"), 42.f },
		{ TEXT("S_A2_Stand"),       16, TEXT("ZoneEnter:A2_Erg"),      TEXT("PlayDialogue"),  TEXT("A2_Kair_02"), 45.f },
		{ TEXT("S_A2_WormHint"),    17, TEXT("WormState:Listening"),   TEXT("Hint"),          TEXT("Не бегите. Держитесь камня.|Don't run. Keep to the rock."), 0.f },
		{ TEXT("S_A2_RevealTitle"), 20, TEXT("Beat:S_A2_Stand"),       TEXT("TitleCard"),     TEXT("Шай-Хулуд|Shai-Hulud"), 0.5f },
		{ TEXT("S_A2_RevealWx"),    21, TEXT("Beat:S_A2_Stand"),       TEXT("SetWeather"),    TEXT("Worm_Reveal,3"), 0.f },
		{ TEXT("S_A2_RevealMusic"), 22, TEXT("Beat:S_A2_Stand"),       TEXT("SetMusic"),      TEXT("WormReveal"), 0.f },
		{ TEXT("S_A2_Reveal"),      23, TEXT("Beat:S_A2_Stand"),       TEXT("PlayCinematic"), TEXT("/Game/Rakis/Cinematics/LS_WormReveal"), 1.f },
		{ TEXT("S_A2_AfterWx"),     24, TEXT("Beat:S_A2_Reveal"),      TEXT("SetWeather"),    TEXT("Morning_Erg,8"), 0.f },
		{ TEXT("S_A2_AfterMusic"),  25, TEXT("Beat:S_A2_Reveal"),      TEXT("SetMusic"),      TEXT("DesertDrone"), 0.f },
		// A3 — Коготь, Оссана, буря на горизонте
		{ TEXT("S_A3_Title"),       30, TEXT("ZoneEnter:A3_Approach"), TEXT("TitleCard"),     TEXT("Коготь|The Claw"), 1.f },
		{ TEXT("S_A3_Weather"),     31, TEXT("ZoneEnter:A3_Approach"), TEXT("SetWeather"),    TEXT("Noon_Approach,12"), 0.f },
		{ TEXT("S_A3_Ossana"),      32, TEXT("ZoneEnter:A3_Approach"), TEXT("PlayDialogue"),  TEXT("A3_Ossana_01"), 4.f },
		{ TEXT("S_A3_Storm"),       33, TEXT("ZoneEnter:A3_Approach"), TEXT("SetWeather"),    TEXT("Storm_Horizon,20"), 30.f },
		// A4 — расщелина
		{ TEXT("S_A4_Weather"),     40, TEXT("ZoneEnter:A4_Crevice"),  TEXT("SetWeather"),    TEXT("Crevice_Shade,4"), 0.f },
		// B1 — шлюз
		{ TEXT("S_B1_Title"),       50, TEXT("ZoneEnter:B1_Airlock"),  TEXT("TitleCard"),     TEXT("Табр-ан-Нур|Tabr-an-Nur"), 1.f },
		{ TEXT("S_B1_Weather"),     51, TEXT("ZoneEnter:B1_Airlock"),  TEXT("SetWeather"),    TEXT("Sietch_Interior,3"), 0.f },
		{ TEXT("S_B1_Guard"),       52, TEXT("ZoneEnter:B1_Airlock"),  TEXT("PlayDialogue"),  TEXT("B1_Guard_01"), 2.5f },
		// B2 — рынок; ритуал через 4 мин
		{ TEXT("S_B2_Music"),       60, TEXT("ZoneEnter:B2_Gallery"),  TEXT("SetMusic"),      TEXT("SietchLife"), 0.f },
		{ TEXT("S_B2_RitualTimer"), 61, TEXT("ZoneEnter:B2_Gallery"),  TEXT("CrowdRitual"),   TEXT(""), 240.f },
		// B3 — проходы; ритуал сразу
		{ TEXT("S_B3_Music"),       70, TEXT("ZoneEnter:B3_Passages"), TEXT("SetMusic"),      TEXT("SietchNarrow"), 0.f },
		{ TEXT("S_B3_Ritual"),      71, TEXT("ZoneEnter:B3_Passages"), TEXT("CrowdRitual"),   TEXT(""), 0.f },
		{ TEXT("S_B3_Ilva"),        72, TEXT("ZoneEnter:B3_Passages"), TEXT("PlayDialogue"),  TEXT("B3_Ilva_01"), 8.f },
		// B5 — зал, финал
		{ TEXT("S_B5_Title"),       80, TEXT("ZoneEnter:B5_Hall"),     TEXT("TitleCard"),     TEXT("Глотка Бога|The Throat of God"), 1.f },
		{ TEXT("S_B5_Weather"),     81, TEXT("ZoneEnter:B5_Hall"),     TEXT("SetWeather"),    TEXT("Hall_Ritual,4"), 0.f },
		{ TEXT("S_B5_Music"),       82, TEXT("ZoneEnter:B5_Hall"),     TEXT("SetMusic"),      TEXT("HallChorale"), 0.f },
		{ TEXT("S_B5_Ritual"),      83, TEXT("ZoneEnter:B5_Hall"),     TEXT("CrowdRitual"),   TEXT(""), 0.f },
		{ TEXT("S_B5_Finale"),      84, TEXT("ZoneEnter:B5_Hall"),     TEXT("PlayCinematic"), TEXT("/Game/Rakis/Cinematics/LS_HallFinale"), 8.f },
		{ TEXT("S_B5_Harmat"),      85, TEXT("Beat:S_B5_Finale"),      TEXT("PlayDialogue"),  TEXT("B5_Harmat_01"), 0.5f },
		{ TEXT("S_B5_End"),         86, TEXT("Beat:S_B5_Harmat"),      TEXT("EndDemo"),       TEXT(""), 2.f },
	};

	// --- Консоль ---
	static void HandleFireCommand(const TArray<FString>& Args, UWorld* World)
	{
		ARakisStoryDirector* Director = ARakisStoryDirector::Find(World);
		if (!Director || Args.Num() == 0)
		{
			UE_LOG(LogRakis, Display, TEXT("Usage: Rakis.Story.Fire <Trigger>  (e.g. ZoneEnter:B5_Hall, Beat:S_A2_Stand, Start)"));
			return;
		}
		Director->FireTrigger(FName(*Args[0]));
	}

	static void HandleListCommand(const TArray<FString>& Args, UWorld* World)
	{
		if (const ARakisStoryDirector* Director = ARakisStoryDirector::Find(World))
		{
			Director->DumpBeats();
		}
	}

	static FAutoConsoleCommandWithWorldAndArgs GRakisStoryFire(
		TEXT("Rakis.Story.Fire"), TEXT("Запустить сюжетный триггер: Rakis.Story.Fire ZoneEnter:B5_Hall"),
		FConsoleCommandWithWorldAndArgsDelegate::CreateStatic(&HandleFireCommand));

	static FAutoConsoleCommandWithWorldAndArgs GRakisStoryList(
		TEXT("Rakis.Story.List"), TEXT("Список сюжетных битов и их состояние"),
		FConsoleCommandWithWorldAndArgsDelegate::CreateStatic(&HandleListCommand));
}

bool ARakisStoryDirector::AreEllipsesEnabled()
{
	return RakisStoryPrivate::CVarStoryEllipsis.GetValueOnGameThread() != 0;
}

ARakisStoryDirector::ARakisStoryDirector()
{
	PrimaryActorTick.bCanEverTick = false;
	Tags.AddUnique(RakisStoryPrivate::StoryTag);
}

ARakisStoryDirector* ARakisStoryDirector::Find(const UObject* WorldContextObject)
{
	UWorld* World = (WorldContextObject && GEngine) ? GEngine->GetWorldFromContextObject(WorldContextObject, EGetWorldErrorMode::ReturnNull) : nullptr;
	if (!World)
	{
		return nullptr;
	}
	ARakisStoryDirector* First = nullptr;
	for (TActorIterator<ARakisStoryDirector> It(World); It; ++It)
	{
		if (It->ActorHasTag(RakisStoryPrivate::StoryTag))
		{
			return *It;
		}
		if (!First)
		{
			First = *It;
		}
	}
	return First;
}

// ---------------------------------------------------------------------------------------------
// Жизненный цикл

void ARakisStoryDirector::BeginPlay()
{
	Super::BeginPlay();
	Tags.AddUnique(RakisStoryPrivate::StoryTag);

	LoadBeats();

	if (URakisDialogueSubsystem* Dialogue = URakisDialogueSubsystem::Get(this))
	{
		// Подсистема GameInstance переживает рестарт уровня — чистим очередь прошлой сессии.
		Dialogue->StopAll();
		Dialogue->OnChainFinished.AddUniqueDynamic(this, &ARakisStoryDirector::HandleDialogueChainFinished);
	}

	BindSystems();

	FTimerManager& Timers = GetWorldTimerManager();
	Timers.SetTimer(BindTimer, FTimerDelegate::CreateWeakLambda(this, [this]()
	{
		TryBindWorm();
		TryBindInteraction();
	}), 1.f, true, 0.1f);

	bool bHasNoiseBeats = false;
	for (const FRakisRuntimeBeat& Beat : Beats)
	{
		bHasNoiseBeats |= Beat.NoiseThreshold >= 0.f;
	}
	if (bHasNoiseBeats)
	{
		Timers.SetTimer(NoisePollTimer, FTimerDelegate::CreateUObject(this, &ARakisStoryDirector::PollNoise), 0.1f, true);
	}

	// Старт — с небольшой задержкой, чтобы HUD, зоны и спутники успели подписаться.
	Timers.SetTimer(StartTimer, FTimerDelegate::CreateUObject(this, &ARakisStoryDirector::FireStart), 0.5f, false);
}

void ARakisStoryDirector::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	if (IsEllipsisInProgress())
	{
		SetPlayerInputLocked(false);
	}
	ResetEllipsis();
	GetWorldTimerManager().ClearAllTimersForObject(this);
	for (FRakisRuntimeBeat& Beat : Beats)
	{
		GetWorldTimerManager().ClearTimer(Beat.DelayTimer);
	}

	if (URakisDialogueSubsystem* Dialogue = URakisDialogueSubsystem::Get(this))
	{
		Dialogue->OnChainFinished.RemoveDynamic(this, &ARakisStoryDirector::HandleDialogueChainFinished);
	}
	if (UWorld* World = GetWorld())
	{
		if (URakisZoneSubsystem* Zones = World->GetSubsystem<URakisZoneSubsystem>())
		{
			Zones->OnZoneChanged.RemoveDynamic(this, &ARakisStoryDirector::HandleZoneChanged);
		}
	}
	if (ARakisWorm* Worm = BoundWorm.Get())
	{
		Worm->OnWormStateChanged.RemoveDynamic(this, &ARakisStoryDirector::HandleWormStateChanged);
	}
	if (URakisInteractionComponent* Interaction = BoundInteraction.Get())
	{
		Interaction->OnInteracted.RemoveDynamic(this, &ARakisStoryDirector::HandleInteracted);
	}
	if (ARakisCinematicTrigger* Trigger = ActiveTrigger.Get())
	{
		Trigger->OnFinished.RemoveDynamic(this, &ARakisStoryDirector::HandleCinematicFinished);
	}
	Super::EndPlay(EndPlayReason);
}

// ---------------------------------------------------------------------------------------------
// Данные

void ARakisStoryDirector::LoadBeats()
{
	Beats.Reset();

	const URakisSettings* Settings = URakisSettings::Get();
	UDataTable* Table = (Settings && !Settings->StoryBeats.IsNull()) ? Settings->StoryBeats.LoadSynchronous() : nullptr;
	if (Table && Table->GetRowStruct() && Table->GetRowStruct()->IsChildOf(FRakisStoryBeatRow::StaticStruct()))
	{
		for (const TPair<FName, uint8*>& Pair : Table->GetRowMap())
		{
			const FRakisStoryBeatRow* Row = reinterpret_cast<const FRakisStoryBeatRow*>(Pair.Value);
			if (!Row)
			{
				continue;
			}
			FRakisRuntimeBeat& Beat = Beats.AddDefaulted_GetRef();
			Beat.BeatID = Pair.Key;
			Beat.Row = *Row;
		}
	}

	if (Beats.Num() == 0)
	{
		if (bUseBuiltInBeatsIfTableMissing)
		{
			UE_LOG(LogRakis, Warning, TEXT("RakisStory: DT_StoryBeats missing or empty — using built-in scenario beats"));
			BuildBuiltInBeats();
		}
		else
		{
			UE_LOG(LogRakis, Warning, TEXT("RakisStory: DT_StoryBeats missing — story disabled"));
		}
	}

	// Порядок исполнения — по Order (стабильно).
	Beats.StableSort([](const FRakisRuntimeBeat& A, const FRakisRuntimeBeat& B) { return A.Row.Order < B.Row.Order; });

	// Предразбор NoiseAbove:<x>.
	for (FRakisRuntimeBeat& Beat : Beats)
	{
		FString Trigger = Beat.Row.Trigger.ToString();
		FString Left, Right;
		if (Trigger.Split(TEXT(":"), &Left, &Right) && Left.Equals(TEXT("NoiseAbove"), ESearchCase::IgnoreCase))
		{
			Beat.NoiseThreshold = FMath::Clamp(FCString::Atof(*Right), 0.f, 10.f);
		}
	}
}

void ARakisStoryDirector::BuildBuiltInBeats()
{
	using namespace RakisStoryPrivate;
	for (const FBuiltInBeat& Source : BuiltInBeats)
	{
		FRakisRuntimeBeat& Beat = Beats.AddDefaulted_GetRef();
		Beat.BeatID = FName(Source.BeatID);
		Beat.Row.Order = Source.Order;
		Beat.Row.Trigger = FName(Source.Trigger);
		Beat.Row.Action = FName(Source.Action);
		Beat.Row.Param = Source.Param;
		Beat.Row.Delay = Source.Delay;
	}
}

void ARakisStoryDirector::DumpBeats() const
{
	UE_LOG(LogRakis, Display, TEXT("RakisStory: %d beats"), Beats.Num());
	for (const FRakisRuntimeBeat& Beat : Beats)
	{
		UE_LOG(LogRakis, Display, TEXT("  [%3d] %-20s %-26s %-14s fired=%d done=%d  %s"),
			Beat.Row.Order, *Beat.BeatID.ToString(), *Beat.Row.Trigger.ToString(), *Beat.Row.Action.ToString(),
			Beat.bFired ? 1 : 0, Beat.bCompleted ? 1 : 0, *Beat.Row.Param);
	}
}

bool ARakisStoryDirector::HasBeatFired(FName BeatID) const
{
	for (const FRakisRuntimeBeat& Beat : Beats)
	{
		if (Beat.BeatID == BeatID)
		{
			return Beat.bFired;
		}
	}
	return false;
}

// ---------------------------------------------------------------------------------------------
// Привязки

void ARakisStoryDirector::BindSystems()
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}
	if (URakisZoneSubsystem* Zones = World->GetSubsystem<URakisZoneSubsystem>())
	{
		Zones->OnZoneChanged.AddUniqueDynamic(this, &ARakisStoryDirector::HandleZoneChanged);
	}
	TryBindWorm();
	TryBindInteraction();
}

void ARakisStoryDirector::TryBindWorm()
{
	if (BoundWorm.IsValid())
	{
		return;
	}
	if (UWorld* World = GetWorld())
	{
		for (TActorIterator<ARakisWorm> It(World); It; ++It)
		{
			BoundWorm = *It;
			It->OnWormStateChanged.AddUniqueDynamic(this, &ARakisStoryDirector::HandleWormStateChanged);
			break;
		}
	}
}

void ARakisStoryDirector::TryBindInteraction()
{
	const ARakisCharacter* Character = Cast<ARakisCharacter>(UGameplayStatics::GetPlayerPawn(this, 0));
	URakisInteractionComponent* Interaction = Character ? Character->GetInteraction() : nullptr;
	if (Interaction == BoundInteraction.Get())
	{
		return;
	}
	if (URakisInteractionComponent* Old = BoundInteraction.Get())
	{
		Old->OnInteracted.RemoveDynamic(this, &ARakisStoryDirector::HandleInteracted);
	}
	BoundInteraction = Interaction;
	if (Interaction)
	{
		Interaction->OnInteracted.AddUniqueDynamic(this, &ARakisStoryDirector::HandleInteracted);
	}
}

void ARakisStoryDirector::FireStart()
{
	if (bStarted)
	{
		return;
	}
	bStarted = true;
	FireTrigger(FName(TEXT("Start")));

	// Текущая зона на старте (если зоны уже определили игрока).
	if (UWorld* World = GetWorld())
	{
		if (const URakisZoneSubsystem* Zones = World->GetSubsystem<URakisZoneSubsystem>())
		{
			const ERakisZone Zone = Zones->GetPlayerZone();
			if (Zone != ERakisZone::None)
			{
				FireTrigger(FName(*(TEXT("ZoneEnter:") + RakisStoryPrivate::EnumShortName(Zone))));
			}
		}
	}
}

// ---------------------------------------------------------------------------------------------
// Триггеры

void ARakisStoryDirector::FireTrigger(FName TriggerKey)
{
	if (TriggerKey.IsNone())
	{
		return;
	}
	for (int32 Index = 0; Index < Beats.Num(); ++Index)
	{
		if (!Beats[Index].bFired && Beats[Index].Row.Trigger == TriggerKey)
		{
			ScheduleBeat(Index);
		}
	}
}

void ARakisStoryDirector::NotifyInteract(FName Tag)
{
	if (Tag.IsNone())
	{
		return;
	}
	const FName Key(*(TEXT("Interact:") + Tag.ToString()));
	// Флаг для Condition реплик (docs/design/mechanics.md §5.3: Interact:<ActorTag>).
	if (URakisDialogueSubsystem* Dialogue = URakisDialogueSubsystem::Get(this))
	{
		Dialogue->SetFlag(Key, true);
	}
	FireTrigger(Key);
}

void ARakisStoryDirector::HandleZoneChanged(ERakisZone OldZone, ERakisZone NewZone)
{
	if (NewZone == ERakisZone::None)
	{
		return;
	}
	const FName Key(*(TEXT("ZoneEnter:") + RakisStoryPrivate::EnumShortName(NewZone)));
	// Во время склейки зона меняется в чёрном — биты зоны прибытия исполняем после возврата картинки.
	if (Ellipsis.Phase == ERakisEllipsisPhase::FadingOut || Ellipsis.Phase == ERakisEllipsisPhase::Black)
	{
		Ellipsis.DeferredTriggers.AddUnique(Key);
		return;
	}
	FireTrigger(Key);
}

void ARakisStoryDirector::HandleWormStateChanged(ERakisWormState OldState, ERakisWormState NewState)
{
	const FString NewName = RakisStoryPrivate::EnumShortName(NewState);
	if (URakisDialogueSubsystem* Dialogue = URakisDialogueSubsystem::Get(this))
	{
		// Флаги для Condition реплик: актуально только текущее состояние.
		Dialogue->SetFlag(FName(*(TEXT("WormState:") + RakisStoryPrivate::EnumShortName(OldState))), false);
		Dialogue->SetFlag(FName(*(TEXT("WormState:") + NewName)), true);
	}
	FireTrigger(FName(*(TEXT("WormState:") + NewName)));
}

void ARakisStoryDirector::HandleInteracted(AActor* Actor)
{
	if (!Actor)
	{
		return;
	}
	// Копия: обработчики могут менять теги.
	const TArray<FName> ActorTags = Actor->Tags;
	for (const FName& Tag : ActorTags)
	{
		NotifyInteract(Tag);
	}
}

void ARakisStoryDirector::PollNoise()
{
	const ARakisCharacter* Character = Cast<ARakisCharacter>(UGameplayStatics::GetPlayerPawn(this, 0));
	const URakisNoiseComponent* Noise = Character ? Character->GetNoise() : nullptr;
	if (!Noise)
	{
		return;
	}
	const float Value = Noise->GetNoise01();
	for (int32 Index = 0; Index < Beats.Num(); ++Index)
	{
		const FRakisRuntimeBeat& Beat = Beats[Index];
		if (!Beat.bFired && Beat.NoiseThreshold >= 0.f && Value > Beat.NoiseThreshold)
		{
			ScheduleBeat(Index);
		}
	}
}

// ---------------------------------------------------------------------------------------------
// Исполнение

void ARakisStoryDirector::ScheduleBeat(int32 Index, float OverrideDelay)
{
	if (!Beats.IsValidIndex(Index) || Beats[Index].bFired)
	{
		return;
	}
	FRakisRuntimeBeat& Beat = Beats[Index];
	Beat.bFired = true;
	UE_LOG(LogRakis, Log, TEXT("RakisStory: beat %s fired (%s → %s %s, delay %.1f)"),
		*Beat.BeatID.ToString(), *Beat.Row.Trigger.ToString(), *Beat.Row.Action.ToString(), *Beat.Row.Param, Beat.Row.Delay);
	OnBeatFired.Broadcast(Beat.BeatID);

	const float BeatDelay = OverrideDelay >= 0.f ? OverrideDelay : Beat.Row.Delay;
	if (BeatDelay > 0.f)
	{
		GetWorldTimerManager().SetTimer(Beats[Index].DelayTimer,
			FTimerDelegate::CreateUObject(this, &ARakisStoryDirector::ExecuteBeat, Index), BeatDelay, false);
	}
	else
	{
		ExecuteBeat(Index);
	}
}

void ARakisStoryDirector::ExecuteBeat(int32 Index)
{
	using namespace RakisStoryPrivate;
	if (!Beats.IsValidIndex(Index))
	{
		return;
	}
	const FName Action = Beats[Index].Row.Action;
	const FString Param = Beats[Index].Row.Param;
	URakisDialogueSubsystem* Dialogue = URakisDialogueSubsystem::Get(this);

	auto PipeText = [Dialogue, &Param]() -> FText
	{
		if (Dialogue)
		{
			return Dialogue->PickPipeText(Param);
		}
		FString RU, EN;
		return FText::FromString(Param.Split(TEXT("|"), &RU, &EN) ? EN.TrimStartAndEnd() : Param);
	};

	if (Action == Action_PlayDialogue)
	{
		ActionPlayDialogue(Index);		// завершится по окончании цепочки
		return;
	}
	if (Action == Action_PlayCinematic)
	{
		ActionPlayCinematic(Index);		// завершится по OnFinished
		return;
	}
	if (Action == Action_FadeOut)
	{
		ActionFadeOut(Index);			// завершится после затемнения
		return;
	}
	if (Action == Action_Ellipsis)
	{
		ActionEllipsis(Index);			// завершится в момент возврата картинки (или не завершится — отказ)
		return;
	}

	if (Action == Action_SetWeather)
	{
		ActionSetWeather(Param);
	}
	else if (Action == Action_SetMusic)
	{
		ActionSetMusic(Param);
	}
	else if (Action == Action_TitleCard)
	{
		OnTitleCard.Broadcast(PipeText(), TitleCardHoldSeconds);
	}
	else if (Action == Action_Hint)
	{
		OnHint.Broadcast(PipeText());
	}
	else if (Action == Action_ForceWorm)
	{
		ActionForceWorm(Param);
	}
	else if (Action == Action_CrowdRitual)
	{
		ActionCrowdRitual();
	}
	else if (Action == Action_EndDemo)
	{
		ActionEndDemo();
	}
	else
	{
		UE_LOG(LogRakis, Warning, TEXT("RakisStory: unknown action '%s' in beat %s"), *Action.ToString(), *Beats[Index].BeatID.ToString());
	}
	CompleteBeat(Index);
}

void ARakisStoryDirector::CompleteBeat(int32 Index)
{
	if (!Beats.IsValidIndex(Index) || Beats[Index].bCompleted)
	{
		return;
	}
	Beats[Index].bCompleted = true;
	const FName BeatID = Beats[Index].BeatID;
	const FName BeatKey(*(TEXT("Beat:") + BeatID.ToString()));

	if (URakisDialogueSubsystem* Dialogue = URakisDialogueSubsystem::Get(this))
	{
		Dialogue->SetFlag(BeatKey, true);
	}
	OnBeatCompleted.Broadcast(BeatID);
	FireTrigger(BeatKey);
}

// ---------------------------------------------------------------------------------------------
// Действия

void ARakisStoryDirector::ActionPlayDialogue(int32 Index)
{
	const FName DialogueID(*Beats[Index].Row.Param.TrimStartAndEnd());
	URakisDialogueSubsystem* Dialogue = URakisDialogueSubsystem::Get(this);
	if (!Dialogue || DialogueID.IsNone())
	{
		CompleteBeat(Index);
		return;
	}
	// Регистрируем ожидание ДО PlayLine: отсутствующая строка завершается синхронно.
	PendingDialogueBeats.FindOrAdd(DialogueID).AddUnique(Index);
	Dialogue->PlayLine(DialogueID);
}

void ARakisStoryDirector::HandleDialogueChainFinished(FName FirstDialogueID)
{
	TArray<int32> Waiting;
	if (PendingDialogueBeats.RemoveAndCopyValue(FirstDialogueID, Waiting))
	{
		for (const int32 Index : Waiting)
		{
			CompleteBeat(Index);
		}
	}
}

ARakisCinematicTrigger* ARakisStoryDirector::FindCinematicTrigger(const FString& Param) const
{
	UWorld* World = GetWorld();
	if (!World || Param.IsEmpty())
	{
		return nullptr;
	}
	const FName AsTag(*Param);
	// Короткое имя ассета: "/Game/Rakis/Cinematics/LS_WormReveal[.LS_WormReveal]" → "LS_WormReveal".
	FString ShortName = Param;
	int32 SlashIndex = INDEX_NONE;
	if (ShortName.FindLastChar(TEXT('/'), SlashIndex))
	{
		ShortName.RightChopInline(SlashIndex + 1);
	}
	int32 DotIndex = INDEX_NONE;
	if (ShortName.FindChar(TEXT('.'), DotIndex))
	{
		ShortName.LeftInline(DotIndex);
	}

	for (TActorIterator<ARakisCinematicTrigger> It(World); It; ++It)
	{
		ARakisCinematicTrigger* Trigger = *It;
		if (Trigger->ActorHasTag(AsTag))
		{
			return Trigger;
		}
		const FString SequenceName = Trigger->Sequence.ToSoftObjectPath().GetAssetName();
		if (!SequenceName.IsEmpty() && SequenceName.Equals(ShortName, ESearchCase::IgnoreCase))
		{
			return Trigger;
		}
	}
	return nullptr;
}

void ARakisStoryDirector::ActionPlayCinematic(int32 Index)
{
	if (CinematicBeatIndex != INDEX_NONE)
	{
		UE_LOG(LogRakis, Warning, TEXT("RakisStory: cinematic already playing, beat %s skipped"), *Beats[Index].BeatID.ToString());
		CompleteBeat(Index);
		return;
	}
	const FString Param = Beats[Index].Row.Param.TrimStartAndEnd();

	CinematicBeatIndex = Index;
	ARakisCinematicTrigger* Trigger = FindCinematicTrigger(Param);
	if (Trigger)
	{
		Trigger->OnFinished.AddUniqueDynamic(this, &ARakisStoryDirector::HandleCinematicFinished);
		ActiveTrigger = Trigger;
		SetHUDCinematicMode(true);
		Trigger->Play();
	}
	else
	{
		// Временный триггер (уничтожается сам). Принудительный выход червя в фоллбеке — только для сцены червя.
		const bool bWormScene = Param.Contains(TEXT("Worm"), ESearchCase::IgnoreCase);
		Trigger = ARakisCinematicTrigger::PlaySequenceAtRuntime(this, FSoftObjectPath(Param), bWormScene);
		if (Trigger)
		{
			Trigger->OnFinished.AddUniqueDynamic(this, &ARakisStoryDirector::HandleCinematicFinished);
			ActiveTrigger = Trigger;
			SetHUDCinematicMode(true);
		}
	}

	// Не стартовала (bPlayOnce, ошибка) или уже закончилась синхронно.
	if (CinematicBeatIndex == Index && (!IsValid(Trigger) || !Trigger->IsPlaying()))
	{
		FinishCinematic();
		return;
	}
	if (CinematicBeatIndex == Index)
	{
		GetWorldTimerManager().SetTimer(CinematicSafetyTimer, FTimerDelegate::CreateUObject(this, &ARakisStoryDirector::FinishCinematic),
			FMath::Max(CinematicSafetyTimeout, 1.f), false);
	}
}

void ARakisStoryDirector::HandleCinematicFinished()
{
	FinishCinematic();
}

void ARakisStoryDirector::FinishCinematic()
{
	GetWorldTimerManager().ClearTimer(CinematicSafetyTimer);
	if (ARakisCinematicTrigger* Trigger = ActiveTrigger.Get())
	{
		Trigger->OnFinished.RemoveDynamic(this, &ARakisStoryDirector::HandleCinematicFinished);
	}
	ActiveTrigger.Reset();

	const int32 Index = CinematicBeatIndex;
	CinematicBeatIndex = INDEX_NONE;
	if (Index != INDEX_NONE)
	{
		SetHUDCinematicMode(false);
		CompleteBeat(Index);
	}
}

void ARakisStoryDirector::SetHUDCinematicMode(bool bEnable)
{
	if (ARakisHUD* HUD = ARakisHUD::Get(this))
	{
		HUD->SetCinematicMode(bEnable);
	}
}

void ARakisStoryDirector::ActionSetWeather(const FString& Param)
{
	FString Preset = Param;
	FString BlendString;
	float Blend = 8.f;
	if (Param.Split(TEXT(","), &Preset, &BlendString))
	{
		Blend = FMath::Max(0.f, FCString::Atof(*BlendString.TrimStartAndEnd()));
	}
	Preset.TrimStartAndEndInline();
	if (URakisWeatherSubsystem* Weather = URakisWeatherSubsystem::Get(this))
	{
		Weather->RequestPreset(FName(*Preset), Blend);
	}
}

void ARakisStoryDirector::ActionSetMusic(const FString& Param)
{
	ERakisMusicState State = ERakisMusicState::Silence;
	if (!RakisStoryPrivate::ParseEnum(Param, State))
	{
		UE_LOG(LogRakis, Warning, TEXT("RakisStory: unknown music state '%s'"), *Param);
		return;
	}
	if (URakisAudioDirector* Audio = URakisAudioDirector::Get(this))
	{
		Audio->SetMusicState(State);
	}
}

void ARakisStoryDirector::ActionForceWorm(const FString& Param)
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}
	TryBindWorm();
	ARakisWorm* Worm = BoundWorm.Get();
	if (!Worm)
	{
		UE_LOG(LogRakis, Warning, TEXT("RakisStory: ForceWorm — no ARakisWorm in level"));
		return;
	}
	const FName PointTag(*Param.TrimStartAndEnd());
	for (TActorIterator<AActor> It(World); It; ++It)
	{
		if (It->ActorHasTag(PointTag))
		{
			Worm->ForceSurface(It->GetActorLocation(), It->GetActorRotation());
			return;
		}
	}
	UE_LOG(LogRakis, Warning, TEXT("RakisStory: ForceWorm — no actor with tag '%s'"), *PointTag.ToString());
}

void ARakisStoryDirector::ActionCrowdRitual()
{
	if (bRitualStarted)
	{
		return;
	}
	bRitualStarted = true;
	if (URakisCrowdSubsystem* Crowd = URakisCrowdSubsystem::Get(this))
	{
		Crowd->StartRitual();
	}
}

void ARakisStoryDirector::ActionFadeOut(int32 Index)
{
	// Param = "сек[,удержание]": в чёрное за сек, через «удержание» (по умолч. 0.5) — обратно; удержание < 0 — остаться в чёрном.
	float Seconds = 1.f;
	float Hold = 0.5f;
	FString SecondsString = Beats[Index].Row.Param;
	FString HoldString;
	if (SecondsString.Split(TEXT(","), &SecondsString, &HoldString))
	{
		Hold = FCString::Atof(*HoldString.TrimStartAndEnd());
	}
	if (!SecondsString.TrimStartAndEnd().IsEmpty())
	{
		Seconds = FMath::Max(0.f, FCString::Atof(*SecondsString.TrimStartAndEnd()));
	}

	if (ARakisHUD* HUD = ARakisHUD::Get(this))
	{
		HUD->FadeToBlack(Seconds);
	}

	FTimerHandle CompleteHandle;
	GetWorldTimerManager().SetTimer(CompleteHandle, FTimerDelegate::CreateUObject(this, &ARakisStoryDirector::CompleteBeat, Index),
		FMath::Max(Seconds, 0.01f), false);

	if (Hold >= 0.f)
	{
		FTimerHandle FadeBackHandle;
		GetWorldTimerManager().SetTimer(FadeBackHandle, FTimerDelegate::CreateWeakLambda(this, [this, Seconds]()
		{
			if (ARakisHUD* HUD = ARakisHUD::Get(this))
			{
				HUD->FadeFromBlack(Seconds);
			}
		}), FMath::Max(Seconds + Hold, 0.01f), false);
	}
}

void ARakisStoryDirector::ActionEndDemo()
{
	if (ARakisHUD* HUD = ARakisHUD::Get(this))
	{
		HUD->ShowEndCard();
	}
	else
	{
		UE_LOG(LogRakis, Warning, TEXT("RakisStory: EndDemo — ARakisHUD not found"));
	}
}

// ---------------------------------------------------------------------------------------------
// Эллипсис — склейка золотого пути (docs/design/demo_flow.md §5, docs/ui/ui_design.md §12)
//
// Param = <ТегЦели>[,<FadeSec>[,<AdvanceHours>]][,window=<сек>][,pull=<BeatID>@<сек>]...[|<RU титр>|<EN титр>]
// Порядок: предложение (Offer, опрос 4 Гц, до window с) → затемнение → перенос игрока и группы, время суток,
// титр поверх чёрного → возврат картинки: бит завершён, отложенные ZoneEnter исполнены, биты пропущенных зон
// «проглочены», pull-биты подтянуты → конец (ввод возвращён). Отказ на любом шаге до переноса — свободная игра.

bool ARakisStoryDirector::ParseEllipsisParam(const FString& Param, FRakisEllipsisState& OutState) const
{
	FString Spec = Param;
	FString Card;
	int32 BarIndex = INDEX_NONE;
	if (Param.FindChar(TEXT('|'), BarIndex))
	{
		Spec = Param.Left(BarIndex);
		Card = Param.Mid(BarIndex + 1);
	}

	TArray<FString> Tokens;
	Spec.ParseIntoArray(Tokens, TEXT(","), true);
	if (Tokens.Num() == 0 || Tokens[0].TrimStartAndEnd().IsEmpty())
	{
		return false;
	}

	OutState.TargetTag = FName(*Tokens[0].TrimStartAndEnd());
	OutState.FadeSeconds = EllipsisFadeSeconds;
	OutState.AdvanceHours = 0.f;
	OutState.CardPipe = Card.TrimStartAndEnd();
	float Window = EllipsisOfferWindow;

	int32 Positional = 0;
	for (int32 TokenIndex = 1; TokenIndex < Tokens.Num(); ++TokenIndex)
	{
		const FString Token = Tokens[TokenIndex].TrimStartAndEnd();
		FString Key, Value;
		if (Token.Split(TEXT("="), &Key, &Value))
		{
			Key.TrimStartAndEndInline();
			Value.TrimStartAndEndInline();
			if (Key.Equals(TEXT("window"), ESearchCase::IgnoreCase))
			{
				Window = FMath::Max(1.f, FCString::Atof(*Value));
			}
			else if (Key.Equals(TEXT("pull"), ESearchCase::IgnoreCase))
			{
				FString PullBeat, PullSeconds;
				if (Value.Split(TEXT("@"), &PullBeat, &PullSeconds))
				{
					OutState.Pulls.Emplace(FName(*PullBeat.TrimStartAndEnd()), FMath::Max(0.f, FCString::Atof(*PullSeconds)));
				}
				else
				{
					UE_LOG(LogRakis, Warning, TEXT("RakisStory: Ellipsis pull '%s' — expected <BeatID>@<sec>"), *Value);
				}
			}
			else
			{
				UE_LOG(LogRakis, Warning, TEXT("RakisStory: Ellipsis option '%s' unknown"), *Key);
			}
			continue;
		}
		if (Positional == 0)
		{
			OutState.FadeSeconds = FMath::Clamp(FCString::Atof(*Token), 0.1f, 10.f);
		}
		else if (Positional == 1)
		{
			OutState.AdvanceHours = FMath::Clamp(FCString::Atof(*Token), -24.f, 24.f);
		}
		++Positional;
	}

	const UWorld* World = GetWorld();
	OutState.OfferDeadline = (World ? World->GetTimeSeconds() : 0.0) + Window;
	return true;
}

AActor* ARakisStoryDirector::FindTaggedActor(FName Tag) const
{
	UWorld* World = GetWorld();
	if (!World || Tag.IsNone())
	{
		return nullptr;
	}
	for (TActorIterator<AActor> It(World); It; ++It)
	{
		if (It->ActorHasTag(Tag))
		{
			return *It;
		}
	}
	return nullptr;
}

ERakisZone ARakisStoryDirector::GetPlayerZone() const
{
	const UWorld* World = GetWorld();
	const URakisZoneSubsystem* Zones = World ? World->GetSubsystem<URakisZoneSubsystem>() : nullptr;
	return Zones ? Zones->GetPlayerZone() : ERakisZone::None;
}

void ARakisStoryDirector::SetPlayerInputLocked(bool bLocked) const
{
	if (ARakisCharacter* Character = Cast<ARakisCharacter>(UGameplayStatics::GetPlayerPawn(this, 0)))
	{
		Character->SetInputLocked(bLocked);
	}
}

void ARakisStoryDirector::ResetEllipsis()
{
	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().ClearTimer(EllipsisTimer);
	}
	Ellipsis = FRakisEllipsisState();
}

void ARakisStoryDirector::ActionEllipsis(int32 Index)
{
	const FRakisRuntimeBeat& Beat = Beats[Index];
	if (Ellipsis.Phase != ERakisEllipsisPhase::None)
	{
		UE_LOG(LogRakis, Warning, TEXT("RakisStory: Ellipsis %s declined — another ellipsis is active"), *Beat.BeatID.ToString());
		return;
	}
	if (!AreEllipsesEnabled())
	{
		UE_LOG(LogRakis, Log, TEXT("RakisStory: Ellipsis %s skipped (Rakis.Story.Ellipsis 0) — free play"), *Beat.BeatID.ToString());
		return;
	}

	FRakisEllipsisState NewState;
	if (!ParseEllipsisParam(Beat.Row.Param, NewState))
	{
		UE_LOG(LogRakis, Warning, TEXT("RakisStory: Ellipsis %s — bad Param '%s'"), *Beat.BeatID.ToString(), *Beat.Row.Param);
		return;
	}
	NewState.BeatIndex = Index;
	NewState.Phase = ERakisEllipsisPhase::Offer;
	NewState.Target = FindTaggedActor(NewState.TargetTag);
	Ellipsis = MoveTemp(NewState);

	if (!Ellipsis.Target.IsValid())
	{
		DeclineEllipsis(FString::Printf(TEXT("no actor with tag '%s'"), *Ellipsis.TargetTag.ToString()));
		return;
	}

	PollEllipsisOffer();
	if (Ellipsis.Phase == ERakisEllipsisPhase::Offer)
	{
		GetWorldTimerManager().SetTimer(EllipsisTimer, FTimerDelegate::CreateUObject(this, &ARakisStoryDirector::PollEllipsisOffer),
			RakisStoryPrivate::EllipsisPollSeconds, true);
	}
}

bool ARakisStoryDirector::CheckEllipsisOffer(FString& OutReason) const
{
	const AActor* Target = Ellipsis.Target.Get();
	if (!Target)
	{
		OutReason = TEXT("target gone");
		return false;
	}
	const APawn* PlayerPawn = UGameplayStatics::GetPlayerPawn(this, 0);
	if (!PlayerPawn)
	{
		OutReason = TEXT("no player pawn");
		return false;
	}
	if (CinematicBeatIndex != INDEX_NONE)
	{
		OutReason = TEXT("cinematic playing");
		return false;
	}
	if (const ARakisHUD* HUD = ARakisHUD::Get(this))
	{
		if (HUD->IsCinematicMode() || !HUD->bShowHUD)
		{
			OutReason = TEXT("cinematic mode");
			return false;
		}
		if (HUD->IsPauseMenuOpen() || HUD->IsPhotoModeActive())
		{
			OutReason = TEXT("menu / photo mode");
			return false;
		}
	}
	if (UGameplayStatics::IsGamePaused(this))
	{
		OutReason = TEXT("paused");
		return false;
	}
	if (const ARakisWorm* Worm = BoundWorm.Get())
	{
		const ERakisWormState State = Worm->GetState();
		if (State == ERakisWormState::Listening || State == ERakisWormState::Approach || State == ERakisWormState::Surface)
		{
			OutReason = TEXT("worm threat");
			return false;
		}
	}
	if (const URakisDialogueSubsystem* Dialogue = URakisDialogueSubsystem::Get(this))
	{
		// Склейка — только в тишине: субтитры под чёрным не видны.
		if (Dialogue->IsStoryLinePlaying())
		{
			OutReason = TEXT("story line playing");
			return false;
		}
	}

	// Золотой путь: игрок позади цели (по её направлению) и идёт к ней.
	const FVector TargetLocation = Target->GetActorLocation();
	const FVector PlayerLocation = PlayerPawn->GetActorLocation();
	FVector ToTarget = TargetLocation - PlayerLocation;
	ToTarget.Z = 0.0;
	FVector TargetForward = Target->GetActorForwardVector();
	TargetForward.Z = 0.0;
	TargetForward = TargetForward.IsNearlyZero() ? ToTarget.GetSafeNormal() : TargetForward.GetSafeNormal();
	const double Behind = FVector::DotProduct(TargetForward, ToTarget);
	if (Behind < EllipsisMinBehindCm)
	{
		OutReason = TEXT("player is not behind the target");
		return false;
	}

	FVector Velocity = PlayerPawn->GetVelocity();
	Velocity.Z = 0.0;
	if (Velocity.Size() < EllipsisMinSpeed)
	{
		OutReason = TEXT("player is not walking");
		return false;
	}
	const double HeadingCos = FVector::DotProduct(Velocity.GetSafeNormal(), ToTarget.GetSafeNormal());
	if (HeadingCos < FMath::Cos(FMath::DegreesToRadians(EllipsisMaxHeadingDeg)))
	{
		OutReason = TEXT("player is heading away from the golden path");
		return false;
	}
	return true;
}

void ARakisStoryDirector::PollEllipsisOffer()
{
	if (Ellipsis.Phase != ERakisEllipsisPhase::Offer)
	{
		return;
	}
	FString Reason;
	if (CheckEllipsisOffer(Reason))
	{
		GetWorldTimerManager().ClearTimer(EllipsisTimer);
		BeginEllipsisCut();
		return;
	}
	Ellipsis.LastRejectReason = Reason;

	const UWorld* World = GetWorld();
	if (!AreEllipsesEnabled())
	{
		DeclineEllipsis(TEXT("Rakis.Story.Ellipsis 0"));
	}
	else if (!Ellipsis.Target.IsValid())
	{
		DeclineEllipsis(TEXT("target gone"));
	}
	else if (World && World->GetTimeSeconds() >= Ellipsis.OfferDeadline)
	{
		DeclineEllipsis(FString::Printf(TEXT("offer window expired (%s)"), *Reason));
	}
}

void ARakisStoryDirector::DeclineEllipsis(const FString& Reason)
{
	const FName BeatID = Beats.IsValidIndex(Ellipsis.BeatIndex) ? Beats[Ellipsis.BeatIndex].BeatID : NAME_None;
	UE_LOG(LogRakis, Log, TEXT("RakisStory: Ellipsis %s declined — %s (free play continues)"), *BeatID.ToString(), *Reason);
	// Бит остаётся несостоявшимся: Beat:<ID> не сработает, сюжет продолжается по зонам.
	const TArray<FName> Deferred = MoveTemp(Ellipsis.DeferredTriggers);
	ResetEllipsis();
	// Зоны, в которые игрок успел войти во время прерванного затемнения, не теряются.
	for (const FName& Key : Deferred)
	{
		FireTrigger(Key);
	}
}

void ARakisStoryDirector::BeginEllipsisCut()
{
	Ellipsis.Phase = ERakisEllipsisPhase::FadingOut;
	SetPlayerInputLocked(true);
	if (ARakisHUD* HUD = ARakisHUD::Get(this))
	{
		HUD->FadeToBlack(Ellipsis.FadeSeconds);
	}
	UE_LOG(LogRakis, Log, TEXT("RakisStory: Ellipsis %s → %s (fade %.1f s, +%.2f h)"),
		*Beats[Ellipsis.BeatIndex].BeatID.ToString(), *Ellipsis.TargetTag.ToString(), Ellipsis.FadeSeconds, Ellipsis.AdvanceHours);
	// Небольшой запас: UI-затемнение идёт в реальном времени, таймер — в игровом.
	GetWorldTimerManager().SetTimer(EllipsisTimer, FTimerDelegate::CreateUObject(this, &ARakisStoryDirector::PerformEllipsisCut),
		Ellipsis.FadeSeconds + 0.1f, false);
}

void ARakisStoryDirector::AbortEllipsisAfterFade(const FString& Reason)
{
	if (ARakisHUD* HUD = ARakisHUD::Get(this))
	{
		HUD->FadeFromBlack(Ellipsis.FadeSeconds);
	}
	SetPlayerInputLocked(false);
	DeclineEllipsis(Reason);
}

void ARakisStoryDirector::PerformEllipsisCut()
{
	AActor* Target = Ellipsis.Target.Get();
	APawn* PlayerPawn = UGameplayStatics::GetPlayerPawn(this, 0);
	if (!Target || !PlayerPawn)
	{
		AbortEllipsisAfterFade(TEXT("target or player lost during fade"));
		return;
	}
	if (CinematicBeatIndex != INDEX_NONE || !AreEllipsesEnabled())
	{
		AbortEllipsisAfterFade(TEXT("cinematic started or ellipses disabled during fade"));
		return;
	}

	Ellipsis.Phase = ERakisEllipsisPhase::Black;
	Ellipsis.SourceZone = GetPlayerZone();

	// Перенос игрока: позиция и курс точки, затем поворот контроллера (камера за спиной смотрит по курсу).
	const FVector OldLocation = PlayerPawn->GetActorLocation();
	const FVector NewLocation = Target->GetActorLocation();
	const FRotator NewRotation(0.f, Target->GetActorRotation().Yaw, 0.f);
	if (!PlayerPawn->TeleportTo(NewLocation, NewRotation))
	{
		PlayerPawn->SetActorLocationAndRotation(NewLocation, NewRotation, false, nullptr, ETeleportType::TeleportPhysics);
	}
	if (ACharacter* PlayerCharacter = Cast<ACharacter>(PlayerPawn))
	{
		if (UCharacterMovementComponent* Movement = PlayerCharacter->GetCharacterMovement())
		{
			Movement->StopMovementImmediately();
		}
	}
	if (AController* Controller = PlayerPawn->GetController())
	{
		Controller->SetControlRotation(NewRotation);
	}
	if (const APlayerController* PC = Cast<APlayerController>(PlayerPawn->GetController()))
	{
		if (PC->PlayerCameraManager)
		{
			PC->PlayerCameraManager->SetGameCameraCutThisFrame();
		}
	}

	TeleportGroup(OldLocation, PlayerPawn->GetActorLocation(), NewRotation);

	if (!FMath::IsNearlyZero(Ellipsis.AdvanceHours))
	{
		if (URakisWeatherSubsystem* Weather = URakisWeatherSubsystem::Get(this))
		{
			Weather->SetTimeOfDay(Weather->GetTimeOfDay() + Ellipsis.AdvanceHours);
		}
	}

	float Hold = EllipsisBlackHold;
	if (!Ellipsis.CardPipe.IsEmpty())
	{
		const URakisDialogueSubsystem* Dialogue = URakisDialogueSubsystem::Get(this);
		const FText CardText = Dialogue ? Dialogue->PickPipeText(Ellipsis.CardPipe) : FText::FromString(Ellipsis.CardPipe);
		if (ARakisHUD* HUD = ARakisHUD::Get(this))
		{
			HUD->ShowCutCard(CardText, EllipsisCardHold);
			Hold = RakisStoryPrivate::CutCardFadeIn + EllipsisCardHold + RakisStoryPrivate::CutCardFadeOut + 0.15f;
		}
	}

	GetWorldTimerManager().SetTimer(EllipsisTimer, FTimerDelegate::CreateUObject(this, &ARakisStoryDirector::BeginEllipsisFadeIn),
		FMath::Max(Hold, 0.1f), false);
}

void ARakisStoryDirector::TeleportGroup(const FVector& OldPlayerLocation, const FVector& NewPlayerLocation, const FRotator& Rotation) const
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}

	// Группа: следующие за игроком + все спутники рядом (Оссана после червя). Ждущие далеко (Оссана до A2) остаются.
	TArray<ARakisCompanion*> Group;
	for (TActorIterator<ARakisCompanion> It(World); It; ++It)
	{
		ARakisCompanion* Companion = *It;
		if (Companion->IsFollowing() || FVector::DistSquared(Companion->GetActorLocation(), OldPlayerLocation) <= FMath::Square(EllipsisGroupRadius))
		{
			Group.Add(Companion);
		}
	}
	auto ChainOrder = [](const ARakisCompanion* Companion) -> int32
	{
		if (Companion->ChainIndex > 0)
		{
			return Companion->ChainIndex;
		}
		static const FName Ilva(TEXT("Ilva"));
		static const FName Rayn(TEXT("Rayn"));
		static const FName Ossana(TEXT("Ossana"));
		return Companion->CompanionId == Ilva ? 1 : Companion->CompanionId == Rayn ? 2 : Companion->CompanionId == Ossana ? 3 : 4;
	};
	Group.StableSort([&ChainOrder](const ARakisCompanion& A, const ARakisCompanion& B) { return ChainOrder(&A) < ChainOrder(&B); });

	FVector Back = -Rotation.Vector();
	Back.Z = 0.0;
	Back = Back.GetSafeNormal();
	const FVector Side = FRotationMatrix(Rotation).GetUnitAxis(EAxis::Y);

	for (int32 Slot = 0; Slot < Group.Num(); ++Slot)
	{
		ARakisCompanion* Companion = Group[Slot];
		// Цепочка 3.5 м за игроком со смещением ±60 см (docs/design/mechanics.md §5.2).
		FVector Desired = NewPlayerLocation + Back * (EllipsisCompanionSpacing * (Slot + 1)) + Side * ((Slot % 2 == 0) ? 60.0 : -60.0);

		const float HalfHeight = Companion->GetCapsuleComponent() ? Companion->GetCapsuleComponent()->GetScaledCapsuleHalfHeight() : 90.f;
		FHitResult Hit;
		FCollisionQueryParams QueryParams(SCENE_QUERY_STAT(RakisEllipsisGround), false);
		QueryParams.AddIgnoredActor(Companion);
		const FVector TraceStart = Desired + FVector(0.0, 0.0, 800.0);
		const FVector TraceEnd = Desired - FVector(0.0, 0.0, 3000.0);
		if (World->LineTraceSingleByChannel(Hit, TraceStart, TraceEnd, ECC_Visibility, QueryParams))
		{
			Desired.Z = Hit.ImpactPoint.Z + HalfHeight + 2.0;
		}

		if (!Companion->TeleportTo(Desired, Rotation))
		{
			Companion->SetActorLocationAndRotation(Desired, Rotation, false, nullptr, ETeleportType::TeleportPhysics);
		}
		if (UCharacterMovementComponent* Movement = Companion->GetCharacterMovement())
		{
			Movement->StopMovementImmediately();
		}
		Companion->ResetTrail();
	}
}

void ARakisStoryDirector::BeginEllipsisFadeIn()
{
	Ellipsis.Phase = ERakisEllipsisPhase::FadingIn;
	if (ARakisHUD* HUD = ARakisHUD::Get(this))
	{
		HUD->FadeFromBlack(Ellipsis.FadeSeconds);
	}

	const int32 Index = Ellipsis.BeatIndex;
	const TArray<FName> Deferred = MoveTemp(Ellipsis.DeferredTriggers);
	Ellipsis.DeferredTriggers.Reset();

	// 1) Зоны, через которые «перепрыгнули», не играют свои биты (Коготь A3 при склейке A2 → A4).
	ConsumeSkippedZones(Ellipsis.SourceZone, GetPlayerZone());
	// 2) Склейка состоялась — Beat:<ID> (биты золотого пути).
	CompleteBeat(Index);
	// 3) Биты зоны прибытия — после битов склейки (их реплики встают в очередь следом).
	for (const FName& Key : Deferred)
	{
		FireTrigger(Key);
	}
	// 4) Сжатие времени: pull-биты.
	ApplyEllipsisPulls();

	GetWorldTimerManager().SetTimer(EllipsisTimer, FTimerDelegate::CreateUObject(this, &ARakisStoryDirector::EndEllipsis),
		FMath::Max(Ellipsis.FadeSeconds, 0.1f), false);
}

void ARakisStoryDirector::EndEllipsis()
{
	SetPlayerInputLocked(false);
	UE_LOG(LogRakis, Log, TEXT("RakisStory: Ellipsis to %s done"), *Ellipsis.TargetTag.ToString());
	ResetEllipsis();
}

void ARakisStoryDirector::ConsumeSkippedZones(ERakisZone FromZone, ERakisZone ToZone)
{
	const uint8 From = static_cast<uint8>(FromZone);
	const uint8 To = static_cast<uint8>(ToZone);
	if (FromZone == ERakisZone::None || ToZone == ERakisZone::None || To <= From + 1)
	{
		return;
	}
	for (uint8 ZoneValue = From + 1; ZoneValue < To; ++ZoneValue)
	{
		const FName Key(*(TEXT("ZoneEnter:") + RakisStoryPrivate::EnumShortName(static_cast<ERakisZone>(ZoneValue))));
		for (FRakisRuntimeBeat& Beat : Beats)
		{
			if (!Beat.bFired && Beat.Row.Trigger == Key)
			{
				Beat.bFired = true;	// «проглочен» склейкой: не исполняется и не завершается
				UE_LOG(LogRakis, Log, TEXT("RakisStory: beat %s consumed by ellipsis (zone skipped)"), *Beat.BeatID.ToString());
			}
		}
	}
}

void ARakisStoryDirector::ApplyEllipsisPulls()
{
	FTimerManager& Timers = GetWorldTimerManager();
	for (const TPair<FName, float>& Pull : Ellipsis.Pulls)
	{
		const int32 Index = Beats.IndexOfByPredicate([&Pull](const FRakisRuntimeBeat& Beat) { return Beat.BeatID == Pull.Key; });
		if (Index == INDEX_NONE)
		{
			UE_LOG(LogRakis, Warning, TEXT("RakisStory: Ellipsis pull — no beat '%s'"), *Pull.Key.ToString());
			continue;
		}
		FRakisRuntimeBeat& Beat = Beats[Index];
		if (!Beat.bFired)
		{
			ScheduleBeat(Index, Pull.Value);
		}
		else if (!Beat.bCompleted && Timers.IsTimerActive(Beat.DelayTimer) && Timers.GetTimerRemaining(Beat.DelayTimer) > Pull.Value)
		{
			Timers.SetTimer(Beat.DelayTimer, FTimerDelegate::CreateUObject(this, &ARakisStoryDirector::ExecuteBeat, Index),
				FMath::Max(Pull.Value, 0.01f), false);
		}
	}
}
