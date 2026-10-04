#include "Narrative/RakisDialogueSubsystem.h"

#include "Rakis.h"
#include "Core/RakisSettings.h"
#include "Gameplay/RakisInspectable.h"
#include "Hydration/RakisHydrationComponent.h"
#include "Noise/RakisNoiseComponent.h"
#include "Noise/RakisSandWalkComponent.h"
#include "Player/RakisCharacter.h"
#include "World/RakisZoneSubsystem.h"
#include "Worm/RakisWorm.h"
#include "Components/AudioComponent.h"
#include "Components/SceneComponent.h"
#include "Engine/DataTable.h"
#include "Engine/Engine.h"
#include "Engine/GameInstance.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/Actor.h"
#include "GameFramework/Pawn.h"
#include "CoreGlobals.h"
#include "HAL/IConsoleManager.h"
#include "HAL/PlatformTime.h"
#include "Internationalization/Culture.h"
#include "Internationalization/Internationalization.h"
#include "Kismet/GameplayStatics.h"
#include "Misc/ConfigCacheIni.h"
#include "Sound/SoundBase.h"
#include "UObject/SoftObjectPath.h"

namespace RakisDialoguePrivate
{
	static const TCHAR* ConfigSection = TEXT("Rakis.UI");
	static const FName LoreSpeaker(TEXT("Lore"));
	/** Защита от циклов NextID / пропусков по условию. */
	static constexpr int32 MaxChainSteps = 64;

	/** Консольная команда: Rakis.Lang RU|EN */
	static void HandleLangCommand(const TArray<FString>& Args, UWorld* World)
	{
		if (Args.Num() == 0)
		{
			UE_LOG(LogRakis, Display, TEXT("Usage: Rakis.Lang RU|EN"));
			return;
		}
		if (URakisDialogueSubsystem* Dialogue = URakisDialogueSubsystem::Get(World))
		{
			Dialogue->SetLanguage(Args[0].Equals(TEXT("RU"), ESearchCase::IgnoreCase) ? ERakisLanguage::RU : ERakisLanguage::EN);
		}
	}

	static FAutoConsoleCommandWithWorldAndArgs GRakisLangCommand(
		TEXT("Rakis.Lang"),
		TEXT("Язык субтитров и озвучки: Rakis.Lang RU|EN"),
		FConsoleCommandWithWorldAndArgsDelegate::CreateStatic(&HandleLangCommand));

	static FRakisDialogueRow MakeRow(const TCHAR* Speaker, const TCHAR* RU, const TCHAR* EN, const TCHAR* Emotion = TEXT("Neutral"), const TCHAR* Next = nullptr)
	{
		FRakisDialogueRow Row;
		Row.Speaker = FName(Speaker);
		Row.Line_RU = RU;
		Row.Line_EN = EN;
		Row.Emotion = FName(Emotion);
		Row.Duration = 0.f;
		Row.NextID = Next ? FName(Next) : NAME_None;
		return Row;
	}
}

URakisDialogueSubsystem* URakisDialogueSubsystem::Get(const UObject* WorldContextObject)
{
	if (!WorldContextObject || !GEngine)
	{
		return nullptr;
	}
	const UWorld* World = GEngine->GetWorldFromContextObject(WorldContextObject, EGetWorldErrorMode::ReturnNull);
	const UGameInstance* GI = World ? World->GetGameInstance() : nullptr;
	return GI ? GI->GetSubsystem<URakisDialogueSubsystem>() : nullptr;
}

void URakisDialogueSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	LoadSettings();
	BuildFallbackDialogue();
	LoadTables();

	// Точки интереса (ARakisInspectable) → центрированная надпись-лор.
	InspectHandle = ARakisInspectable::OnInspected.AddUObject(this, &URakisDialogueSubsystem::ShowLore);
}

void URakisDialogueSubsystem::Deinitialize()
{
	ARakisInspectable::OnInspected.Remove(InspectHandle);
	InspectHandle.Reset();
	StopAll();
	Super::Deinitialize();
}

// ---------------------------------------------------------------------------------------------
// Данные

void URakisDialogueSubsystem::LoadTables()
{
	const URakisSettings* Settings = URakisSettings::Get();
	if (!Settings)
	{
		return;
	}

	DialogueTable = Settings->DialogueTable.IsNull() ? nullptr : Settings->DialogueTable.LoadSynchronous();
	if (DialogueTable && !(DialogueTable->GetRowStruct() && DialogueTable->GetRowStruct()->IsChildOf(FRakisDialogueRow::StaticStruct())))
	{
		UE_LOG(LogRakis, Warning, TEXT("RakisDialogue: DialogueTable has wrong row struct, ignored"));
		DialogueTable = nullptr;
	}
	if (!DialogueTable)
	{
		UE_LOG(LogRakis, Warning, TEXT("RakisDialogue: DT_Dialogue_S1 missing — using built-in fallback lines"));
		bWarnedNoDialogueTable = true;
	}

	BarksTable = Settings->BarksTable.IsNull() ? nullptr : Settings->BarksTable.LoadSynchronous();
	if (BarksTable && !(BarksTable->GetRowStruct() && BarksTable->GetRowStruct()->IsChildOf(FRakisBarkRow::StaticStruct())))
	{
		UE_LOG(LogRakis, Warning, TEXT("RakisDialogue: BarksTable has wrong row struct, ignored"));
		BarksTable = nullptr;
	}
}

void URakisDialogueSubsystem::BuildFallbackDialogue()
{
	using namespace RakisDialoguePrivate;
	// Встроенные реплики по docs/01_scenario.md. ID совпадают со встроенными битами ARakisStoryDirector.
	// Если в DT_Dialogue_S1 есть строка с тем же ID — она важнее.
	FallbackDialogue.Reset();
	FallbackDialogue.Add(TEXT("A1_Ilva_01"),   MakeRow(TEXT("Ilva"),   TEXT("Рэйн. Сбей шаг."), TEXT("Rayn. Break your step."), TEXT("Calm"), TEXT("A1_Kair_01")));
	FallbackDialogue.Add(TEXT("A1_Kair_01"),   MakeRow(TEXT("Kair"),   TEXT("Не шагай в такт. Песок слушает."), TEXT("Don't walk in step. The sand is listening."), TEXT("Calm")));
	FallbackDialogue.Add(TEXT("A2_Rayn_01"),   MakeRow(TEXT("Rayn"),   TEXT("Сколько ещё?"), TEXT("How much farther?"), TEXT("Wry"), TEXT("A2_Kair_01")));
	FallbackDialogue.Add(TEXT("A2_Kair_01"),   MakeRow(TEXT("Kair"),   TEXT("Столько, сколько песок позволит."), TEXT("As far as the sand allows."), TEXT("Calm")));
	FallbackDialogue.Add(TEXT("A2_Kair_02"),   MakeRow(TEXT("Kair"),   TEXT("Стоять. Не бежать."), TEXT("Stand still. Don't run."), TEXT("Tense")));
	FallbackDialogue.Add(TEXT("A3_Ossana_01"), MakeRow(TEXT("Ossana"), TEXT("Городские в пустыне пахнут страхом. Кто вас послал?"), TEXT("Town folk smell of fear out here. Who sent you?"), TEXT("Angry"), TEXT("A3_Kair_01")));
	FallbackDialogue.Add(TEXT("A3_Kair_01"),   MakeRow(TEXT("Kair"),   TEXT("Жрецы Кина."), TEXT("The priests of Keen."), TEXT("Neutral"), TEXT("A3_Ossana_02")));
	FallbackDialogue.Add(TEXT("A3_Ossana_02"), MakeRow(TEXT("Ossana"), TEXT("Тогда вам к наибу. Молитесь, чтобы он был в духе."), TEXT("Then you want the naib. Pray he's in a good mood."), TEXT("Wry")));
	FallbackDialogue.Add(TEXT("B1_Guard_01"),  MakeRow(TEXT("Guard"),  TEXT("Маски подтяни. Здесь влагу не дарят."), TEXT("Tighten your masks. Nobody gives water away here."), TEXT("Neutral")));
	FallbackDialogue.Add(TEXT("B3_Ilva_01"),   MakeRow(TEXT("Ilva"),   TEXT("Не смотри на воду так долго. Здесь это оскорбление."), TEXT("Don't look at the water so long. Here that is an insult."), TEXT("Whisper")));
	FallbackDialogue.Add(TEXT("B5_Harmat_01"), MakeRow(TEXT("Harmat"), TEXT("Вы пришли от тех, кто променял Бога на воду. Посмотрим, что вы принесли."), TEXT("You come from those who traded God for water. Let us see what you have brought."), TEXT("Reverent")));
	// Образцы лора (Speaker = Lore) — для проверки ShowLore на блокауте.
	FallbackDialogue.Add(TEXT("Lore_Carving"), MakeRow(TEXT("Lore"),   TEXT("Червь, обвивший каплю. Камень отполирован ладонями до блеска."), TEXT("A worm coiled around a single drop. The stone is polished to a shine by hands."), TEXT("Reverent")));
	FallbackDialogue.Add(TEXT("Lore_Grate"),   MakeRow(TEXT("Lore"),   TEXT("За решёткой — тёмная вода. Счёт ей ведут каплями."), TEXT("Behind the grate, dark water. It is counted in drops."), TEXT("Reverent")));
}

const FRakisDialogueRow* URakisDialogueSubsystem::FindDialogueRow(FName DialogueID) const
{
	if (DialogueID.IsNone())
	{
		return nullptr;
	}
	if (DialogueTable)
	{
		if (const FRakisDialogueRow* Row = DialogueTable->FindRow<FRakisDialogueRow>(DialogueID, TEXT("RakisDialogue"), /*bWarnIfRowMissing*/ false))
		{
			return Row;
		}
	}
	if (const FRakisDialogueRow* Fallback = FallbackDialogue.Find(DialogueID))
	{
		return Fallback;
	}
	if (!WarnedMissingLines.Contains(DialogueID))
	{
		WarnedMissingLines.Add(DialogueID);
		UE_LOG(LogRakis, Warning, TEXT("RakisDialogue: line '%s' not found"), *DialogueID.ToString());
	}
	return nullptr;
}

// ---------------------------------------------------------------------------------------------
// Сюжетные реплики

void URakisDialogueSubsystem::PlayLine(FName DialogueID)
{
	if (DialogueID.IsNone())
	{
		return;
	}
	// Не допускаем дублей одной и той же цепочки в очереди.
	if (DialogueID == CurrentChainStart || ChainQueue.Contains(DialogueID))
	{
		return;
	}
	if (bLinePlaying || ChainQueue.Num() > 0)
	{
		ChainQueue.Add(DialogueID);
		StartNextQueued();
		return;
	}
	StartChain(DialogueID);
}

void URakisDialogueSubsystem::StartChain(FName FirstID)
{
	CurrentChainStart = FirstID;
	// Первую реплику цепочки явно запросил StoryDirector/скрипт — её Condition не проверяем
	// (docs/design/mechanics.md §5.3: «пусто — реплику запускает StoryDirector»; реакции проверяют IsConditionMet сами).
	StartLine(FirstID, /*bIgnoreCondition*/ true);
}

bool URakisDialogueSubsystem::IsConditionMet(FName Condition) const
{
	if (Condition.IsNone() || Flags.Contains(Condition))
	{
		return true;
	}
	FString Key, Value;
	if (!Condition.ToString().Split(TEXT(":"), &Key, &Value))
	{
		return false;
	}
	Value.TrimStartAndEndInline();

	UWorld* World = GetGameWorld();
	if (!World)
	{
		return false;
	}
	const ARakisCharacter* Character = Cast<ARakisCharacter>(UGameplayStatics::GetPlayerPawn(World, 0));

	// Живые условия (docs/design/mechanics.md §5.3); Beat:/Interact: — только флаги.
	if (Key == TEXT("ZoneEnter"))
	{
		const URakisZoneSubsystem* Zones = World->GetSubsystem<URakisZoneSubsystem>();
		const UEnum* ZoneEnum = StaticEnum<ERakisZone>();
		return Zones && ZoneEnum && ZoneEnum->GetNameStringByValue(static_cast<int64>(Zones->GetPlayerZone())).Equals(Value, ESearchCase::IgnoreCase);
	}
	if (Key == TEXT("WormState"))
	{
		const UEnum* WormEnum = StaticEnum<ERakisWormState>();
		TActorIterator<ARakisWorm> It(World);
		return It && WormEnum && WormEnum->GetNameStringByValue(static_cast<int64>(It->GetState())).Equals(Value, ESearchCase::IgnoreCase);
	}
	if (!Character)
	{
		return false;
	}
	if (Key == TEXT("NoiseAbove"))
	{
		const URakisNoiseComponent* Noise = Character->GetNoise();
		return Noise && Noise->GetNoise01() > FCString::Atof(*Value);
	}
	if (Key == TEXT("SandWalk"))
	{
		const URakisSandWalkComponent* SandWalk = Character->GetSandWalk();
		if (!SandWalk || !SandWalk->IsSandWalking())
		{
			return false;
		}
		return Value.Equals(TEXT("Regular"), ESearchCase::IgnoreCase) ? SandWalk->GetRhythmRegularity() > 0.75f
			: Value.Equals(TEXT("Irregular"), ESearchCase::IgnoreCase) && SandWalk->GetRhythmRegularity() < 0.3f;
	}
	if (Key == TEXT("Surface"))
	{
		const UEnum* SurfaceEnum = StaticEnum<ERakisSurface>();
		return SurfaceEnum && SurfaceEnum->GetNameStringByValue(static_cast<int64>(Character->GetCurrentSurface())).Equals(Value, ESearchCase::IgnoreCase);
	}
	if (Key == TEXT("MoistureBelow"))
	{
		const URakisHydrationComponent* Hydration = Character->GetHydration();
		return Hydration && Hydration->GetMoisture01() < FCString::Atof(*Value);
	}
	return false;
}

void URakisDialogueSubsystem::StartLine(FName DialogueID, bool bIgnoreCondition)
{
	using namespace RakisDialoguePrivate;

	// Пропускаем строки, чьё условие не выполнено (идём по NextID), с защитой от циклов.
	const FRakisDialogueRow* Row = FindDialogueRow(DialogueID);
	int32 Steps = 0;
	while (!bIgnoreCondition && Row && !IsConditionMet(Row->Condition) && Steps++ < MaxChainSteps)
	{
		UE_LOG(LogRakis, Verbose, TEXT("RakisDialogue: '%s' skipped (condition %s)"), *DialogueID.ToString(), *Row->Condition.ToString());
		DialogueID = Row->NextID;
		Row = FindDialogueRow(DialogueID);
	}

	if (!Row)
	{
		// Строки нет — считаем её мгновенно завершённой, чтобы сюжетные биты не зависали.
		if (!DialogueID.IsNone())
		{
			OnLineFinished.Broadcast(DialogueID);
		}
		FinishChain();
		return;
	}

	bLinePlaying = true;
	CurrentLineID = DialogueID;

	const FText LineText = PickText(Row->Line_RU, Row->Line_EN);

	float SoundDuration = 0.f;
	StopCurrentVO();
	if (!Row->VO_File.IsEmpty())
	{
		CurrentVO = PlayVO(Row->VO_File, FindSpeakerActor(Row->Speaker), SoundDuration);
	}

	float Duration = Row->Duration > 0.f ? Row->Duration : ComputeAutoDuration(LineText.ToString());
	if (SoundDuration > 0.f)
	{
		Duration = FMath::Max(Duration, SoundDuration + 0.3f);
	}

	if (Row->Speaker == LoreSpeaker)
	{
		OnLore.Broadcast(LineText, Duration);
	}
	else
	{
		OnSubtitle.Broadcast(GetSpeakerDisplayName(Row->Speaker), LineText, Duration);
	}

	if (UGameInstance* GI = GetGameInstance())
	{
		GI->GetTimerManager().SetTimer(LineTimer, FTimerDelegate::CreateUObject(this, &URakisDialogueSubsystem::HandleLineTimer), Duration, false);
	}
	else
	{
		HandleLineTimer();
	}
}

void URakisDialogueSubsystem::HandleLineTimer()
{
	const FName Finished = CurrentLineID;
	const FRakisDialogueRow* Row = FindDialogueRow(Finished);
	const FName Next = Row ? Row->NextID : NAME_None;

	OnLineFinished.Broadcast(Finished);

	if (!Next.IsNone() && Next != Finished)
	{
		StartLine(Next);
	}
	else
	{
		FinishChain();
	}
}

void URakisDialogueSubsystem::FinishChain()
{
	const FName ChainStart = CurrentChainStart;
	bLinePlaying = false;
	CurrentLineID = NAME_None;
	CurrentChainStart = NAME_None;

	if (!ChainStart.IsNone())
	{
		OnChainFinished.Broadcast(ChainStart);
	}
	StartNextQueued();
}

void URakisDialogueSubsystem::StartNextQueued()
{
	if (bLinePlaying || ChainQueue.Num() == 0)
	{
		return;
	}
	const FName Next = ChainQueue[0];
	ChainQueue.RemoveAt(0);
	StartChain(Next);
}

void URakisDialogueSubsystem::StopAll()
{
	if (UGameInstance* GI = GetGameInstance())
	{
		GI->GetTimerManager().ClearTimer(LineTimer);
	}
	StopCurrentVO();
	ChainQueue.Reset();
	bLinePlaying = false;
	CurrentLineID = NAME_None;
	CurrentChainStart = NAME_None;
	BarkSubtitleUntil = -1000.0;
}

// ---------------------------------------------------------------------------------------------
// Лай

void URakisDialogueSubsystem::PlayBark(FName Archetype, FName Context, AActor* Speaker)
{
	if (!BarksTable)
	{
		if (!bWarnedNoBarksTable)
		{
			bWarnedNoBarksTable = true;
			UE_LOG(LogRakis, Warning, TEXT("RakisDialogue: DT_Barks missing — barks disabled"));
		}
		return;
	}

	const double Now = FPlatformTime::Seconds();
	if (Now - LastBarkTime < BarkGlobalInterval)
	{
		return;
	}

	// Кандидаты без лишних аллокаций (инлайн-буфер).
	TArray<TPair<FName, const FRakisBarkRow*>, TInlineAllocator<32>> Candidates;
	float TotalWeight = 0.f;
	for (const TPair<FName, uint8*>& Pair : BarksTable->GetRowMap())
	{
		const FRakisBarkRow* Row = reinterpret_cast<const FRakisBarkRow*>(Pair.Value);
		if (!Row || Row->Weight <= 0.f)
		{
			continue;
		}
		if (!Archetype.IsNone() && Row->Archetype != Archetype)
		{
			continue;
		}
		if (!Context.IsNone() && Row->Context != Context)
		{
			continue;
		}
		if (const double* Last = BarkLastPlayed.Find(Pair.Key))
		{
			if (Now - *Last < Row->Cooldown)
			{
				continue;
			}
		}
		Candidates.Emplace(Pair.Key, Row);
		TotalWeight += Row->Weight;
	}
	if (Candidates.Num() == 0 || TotalWeight <= 0.f)
	{
		return;
	}

	float Pick = FMath::FRand() * TotalWeight;
	int32 ChosenIndex = Candidates.Num() - 1;
	for (int32 Index = 0; Index < Candidates.Num(); ++Index)
	{
		Pick -= Candidates[Index].Value->Weight;
		if (Pick <= 0.f)
		{
			ChosenIndex = Index;
			break;
		}
	}
	const FName RowName = Candidates[ChosenIndex].Key;
	const FRakisBarkRow* Row = Candidates[ChosenIndex].Value;

	LastBarkTime = Now;
	BarkLastPlayed.Add(RowName, Now);

	float SoundDuration = 0.f;
	if (!Row->VO_File.IsEmpty())
	{
		PlayVO(Row->VO_File, Speaker, SoundDuration);
	}

	// Позиционный субтитр — только если говорящий рядом с игроком.
	UWorld* World = GetGameWorld();
	const APawn* PlayerPawn = World ? UGameplayStatics::GetPlayerPawn(World, 0) : nullptr;
	if (!IsValid(Speaker) || !PlayerPawn)
	{
		return;
	}
	if (FVector::DistSquared(Speaker->GetActorLocation(), PlayerPawn->GetActorLocation()) > FMath::Square(BarkSubtitleRadius))
	{
		return;
	}
	// Во время сюжетной реплики — не более одного лай-субтитра одновременно.
	if (bLinePlaying && Now < BarkSubtitleUntil)
	{
		return;
	}

	const FText LineText = PickText(Row->Line_RU, Row->Line_EN);
	float Duration = FMath::Clamp(ComputeAutoDuration(LineText.ToString()), 1.8f, 5.f);
	if (SoundDuration > 0.f)
	{
		Duration = FMath::Max(Duration, SoundDuration + 0.3f);
	}
	BarkSubtitleUntil = Now + Duration;
	OnBarkSubtitle.Broadcast(LineText, Duration, Speaker);
}

// ---------------------------------------------------------------------------------------------
// Лор

void URakisDialogueSubsystem::ShowLore(FName LoreID)
{
	const FRakisDialogueRow* Row = FindDialogueRow(LoreID);
	if (!Row)
	{
		return;
	}
	const FText Text = PickText(Row->Line_RU, Row->Line_EN);
	float SoundDuration = 0.f;
	if (!Row->VO_File.IsEmpty())
	{
		PlayVO(Row->VO_File, nullptr, SoundDuration);
	}
	// Надпись читают медленнее, чем слушают реплику.
	float Duration = Row->Duration > 0.f ? Row->Duration : FMath::Clamp(0.07f * Text.ToString().Len() + 2.f, 4.f, 10.f);
	Duration = FMath::Max(Duration, SoundDuration + 0.3f);
	OnLore.Broadcast(Text, Duration);
}

// ---------------------------------------------------------------------------------------------
// Говорящие

void URakisDialogueSubsystem::RegisterSpeaker(FName SpeakerID, AActor* Actor)
{
	if (SpeakerID.IsNone())
	{
		return;
	}
	if (IsValid(Actor))
	{
		Speakers.Add(SpeakerID, Actor);
	}
	else
	{
		Speakers.Remove(SpeakerID);
	}
}

void URakisDialogueSubsystem::UnregisterSpeaker(FName SpeakerID)
{
	Speakers.Remove(SpeakerID);
}

AActor* URakisDialogueSubsystem::FindSpeakerActor(FName SpeakerID) const
{
	if (const TWeakObjectPtr<AActor>* Found = Speakers.Find(SpeakerID))
	{
		return Found->Get();
	}
	return nullptr;
}

FText URakisDialogueSubsystem::GetSpeakerDisplayName(FName SpeakerID) const
{
	struct FSpeakerName { const TCHAR* Id; const TCHAR* RU; const TCHAR* EN; };
	static const FSpeakerName Names[] =
	{
		{ TEXT("Kair"),      TEXT("Кайр"),          TEXT("Kair") },
		{ TEXT("Ilva"),      TEXT("Сестра Илва"),   TEXT("Sister Ilva") },
		{ TEXT("Rayn"),      TEXT("Мастер Рэйн"),   TEXT("Master Rayn") },
		{ TEXT("Ossana"),    TEXT("Оссана"),        TEXT("Ossana") },
		{ TEXT("Rider1"),    TEXT("Наездник"),      TEXT("Rider") },
		{ TEXT("Rider2"),    TEXT("Наездник"),      TEXT("Rider") },
		{ TEXT("Guard"),     TEXT("Страж"),         TEXT("Guard") },
		{ TEXT("Harmat"),    TEXT("Наиб Хармат"),   TEXT("Naib Harmat") },
		{ TEXT("Priestess"), TEXT("Жрица"),         TEXT("Priestess") },
		{ TEXT("Crowd"),     TEXT(""),              TEXT("") },
		{ TEXT("Lore"),      TEXT(""),              TEXT("") },
	};
	if (SpeakerID.IsNone())
	{
		return FText::GetEmpty();
	}
	for (const FSpeakerName& Entry : Names)
	{
		if (SpeakerID == FName(Entry.Id))
		{
			return FText::FromString(Language == ERakisLanguage::RU ? Entry.RU : Entry.EN);
		}
	}
	// Неизвестный говорящий — показываем ID как есть.
	return FText::FromName(SpeakerID);
}

void URakisDialogueSubsystem::SetFlag(FName Flag, bool bSet)
{
	if (Flag.IsNone())
	{
		return;
	}
	if (bSet)
	{
		Flags.Add(Flag);
	}
	else
	{
		Flags.Remove(Flag);
	}
}

// ---------------------------------------------------------------------------------------------
// Язык и настройки

FText URakisDialogueSubsystem::PickText(const FString& RU, const FString& EN) const
{
	if (Language == ERakisLanguage::RU)
	{
		return FText::FromString(RU.IsEmpty() ? EN : RU);
	}
	return FText::FromString(EN.IsEmpty() ? RU : EN);
}

FText URakisDialogueSubsystem::PickPipeText(const FString& Pipe) const
{
	FString RU, EN;
	if (!Pipe.Split(TEXT("|"), &RU, &EN))
	{
		RU = Pipe;
		EN = Pipe;
	}
	return PickText(RU.TrimStartAndEnd(), EN.TrimStartAndEnd());
}

float URakisDialogueSubsystem::ComputeAutoDuration(const FString& Line)
{
	return FMath::Clamp(0.06f * Line.Len() + 1.2f, 2.2f, 7.f);
}

void URakisDialogueSubsystem::SetLanguage(ERakisLanguage NewLanguage)
{
	if (Language == NewLanguage)
	{
		return;
	}
	Language = NewLanguage;
	SaveSettings();
	UE_LOG(LogRakis, Log, TEXT("RakisDialogue: language = %s"), Language == ERakisLanguage::RU ? TEXT("RU") : TEXT("EN"));
	OnLanguageChanged.Broadcast(Language);
}

void URakisDialogueSubsystem::SetSubtitleSize(ERakisSubtitleSize NewSize)
{
	SubtitleSize = NewSize;
	SaveSettings();
	OnSubtitleSettingsChanged.Broadcast();
}

void URakisDialogueSubsystem::SetSubtitleBackground(bool bEnabled)
{
	bSubtitleBackground = bEnabled;
	SaveSettings();
	OnSubtitleSettingsChanged.Broadcast();
}

void URakisDialogueSubsystem::LoadSettings()
{
	using namespace RakisDialoguePrivate;

	// По умолчанию — язык культуры ОС: ru* → RU, иначе EN.
	const FString IsoLang = FInternationalization::Get().GetCurrentCulture()->GetTwoLetterISOLanguageName();
	Language = IsoLang.Equals(TEXT("ru"), ESearchCase::IgnoreCase) ? ERakisLanguage::RU : ERakisLanguage::EN;

	if (!GConfig)
	{
		return;
	}
	FString Saved;
	if (GConfig->GetString(ConfigSection, TEXT("Language"), Saved, GGameUserSettingsIni))
	{
		if (Saved.Equals(TEXT("RU"), ESearchCase::IgnoreCase)) { Language = ERakisLanguage::RU; }
		else if (Saved.Equals(TEXT("EN"), ESearchCase::IgnoreCase)) { Language = ERakisLanguage::EN; }
	}
	int32 SizeIndex = 1;
	if (GConfig->GetInt(ConfigSection, TEXT("SubtitleSize"), SizeIndex, GGameUserSettingsIni))
	{
		SubtitleSize = static_cast<ERakisSubtitleSize>(FMath::Clamp(SizeIndex, 0, 2));
	}
	GConfig->GetBool(ConfigSection, TEXT("SubtitleBackground"), bSubtitleBackground, GGameUserSettingsIni);
}

void URakisDialogueSubsystem::SaveSettings() const
{
	using namespace RakisDialoguePrivate;
	if (!GConfig)
	{
		return;
	}
	GConfig->SetString(ConfigSection, TEXT("Language"), Language == ERakisLanguage::RU ? TEXT("RU") : TEXT("EN"), GGameUserSettingsIni);
	GConfig->SetInt(ConfigSection, TEXT("SubtitleSize"), static_cast<int32>(SubtitleSize), GGameUserSettingsIni);
	GConfig->SetBool(ConfigSection, TEXT("SubtitleBackground"), bSubtitleBackground, GGameUserSettingsIni);
	GConfig->Flush(false, GGameUserSettingsIni);
}

// ---------------------------------------------------------------------------------------------
// Звук

UWorld* URakisDialogueSubsystem::GetGameWorld() const
{
	const UGameInstance* GI = GetGameInstance();
	return GI ? GI->GetWorld() : nullptr;
}

UAudioComponent* URakisDialogueSubsystem::PlayVO(const FString& VOPath, AActor* AttachTo, float& OutSoundDuration)
{
	OutSoundDuration = 0.f;
	UWorld* World = GetGameWorld();
	if (!World || VOPath.IsEmpty())
	{
		return nullptr;
	}

	const FSoftObjectPath Path(VOPath);
	USoundBase* Sound = Cast<USoundBase>(Path.TryLoad());
	if (!Sound)
	{
		static TSet<FString> Warned;
		if (!Warned.Contains(VOPath))
		{
			Warned.Add(VOPath);
			UE_LOG(LogRakis, Warning, TEXT("RakisDialogue: VO '%s' not found — subtitle only"), *VOPath);
		}
		return nullptr;
	}

	const float SoundDuration = Sound->GetDuration();
	// MetaSound/зацикленные звуки возвращают «бесконечную» длительность — не учитываем.
	if (SoundDuration > 0.f && SoundDuration < 60.f)
	{
		OutSoundDuration = SoundDuration;
	}

	if (IsValid(AttachTo) && AttachTo->GetRootComponent())
	{
		return UGameplayStatics::SpawnSoundAttached(Sound, AttachTo->GetRootComponent());
	}
	return UGameplayStatics::SpawnSound2D(World, Sound);
}

void URakisDialogueSubsystem::StopCurrentVO()
{
	if (UAudioComponent* AC = CurrentVO.Get())
	{
		AC->Stop();
	}
	CurrentVO.Reset();
}
