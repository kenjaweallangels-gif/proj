#include "Audio/RakisAudioDirector.h"

#include "Rakis.h"
#include "Core/RakisDataTypes.h"
#include "Core/RakisSettings.h"
#include "Weather/RakisWeatherSubsystem.h"
#include "Worm/RakisWorm.h"

#include "Components/AudioComponent.h"
#include "Engine/DataTable.h"
#include "Engine/Engine.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "Kismet/GameplayStatics.h"
#include "Sound/ReverbEffect.h"
#include "Sound/SoundAttenuation.h"
#include "Sound/SoundBase.h"

namespace RakisAudio
{
	static const FName ParamStateIndex(TEXT("StateIndex"));
	static const FName ParamIntensity(TEXT("Intensity"));
	static const FName ParamWormThreat(TEXT("WormThreat"));
	static const FName ParamInterior(TEXT("Interior"));
	static const FName ZoneReverbTag(TEXT("Rakis.ZoneReverb"));

	/** Состояния, которые авто-угроза червя не перебивает. */
	static bool IsProtectedState(ERakisMusicState S)
	{
		return S == ERakisMusicState::WormThreat || S == ERakisMusicState::WormReveal
			|| S == ERakisMusicState::HallChorale || S == ERakisMusicState::SietchLife
			|| S == ERakisMusicState::SietchNarrow;
	}

	static void StopAndDestroy(UAudioComponent* Comp)
	{
		if (Comp)
		{
			Comp->Stop();
			Comp->DestroyComponent();
		}
	}
}

URakisAudioDirector* URakisAudioDirector::Get(const UObject* WorldContextObject)
{
	const UWorld* World = GEngine ? GEngine->GetWorldFromContextObject(WorldContextObject, EGetWorldErrorMode::ReturnNull) : nullptr;
	return World ? World->GetSubsystem<URakisAudioDirector>() : nullptr;
}

bool URakisAudioDirector::DoesSupportWorldType(const EWorldType::Type WorldType) const
{
	return WorldType == EWorldType::Game || WorldType == EWorldType::PIE;
}

void URakisAudioDirector::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
}

void URakisAudioDirector::Deinitialize()
{
	if (ARakisWorm* W = Worm.Get())
	{
		W->OnWormStateChanged.RemoveDynamic(this, &URakisAudioDirector::HandleWormStateChanged);
	}
	RakisAudio::StopAndDestroy(AdaptiveMusic);
	RakisAudio::StopAndDestroy(MusicA);
	RakisAudio::StopAndDestroy(MusicB);
	RakisAudio::StopAndDestroy(AmbienceCurrent);
	RakisAudio::StopAndDestroy(AmbiencePrevious);
	AdaptiveMusic = MusicA = MusicB = AmbienceCurrent = AmbiencePrevious = nullptr;
	SoundCache.Reset();
	AttenuationCache.Reset();
	EventsTable = nullptr;

	Super::Deinitialize();
}

TStatId URakisAudioDirector::GetStatId() const
{
	RETURN_QUICK_DECLARE_CYCLE_STAT(URakisAudioDirector, STATGROUP_Tickables);
}

void URakisAudioDirector::OnWorldBeginPlay(UWorld& InWorld)
{
	Super::OnWorldBeginPlay(InWorld);
	LoadData();
}

void URakisAudioDirector::LoadData()
{
	if (EventsTable)
	{
		return;
	}
	const URakisSettings* Settings = URakisSettings::Get();
	if (Settings && !Settings->AudioEvents.IsNull())
	{
		EventsTable = Settings->AudioEvents.LoadSynchronous();
	}
	if (EventsTable && EventsTable->GetRowStruct() != FRakisAudioEventRow::StaticStruct())
	{
		UE_LOG(LogRakis, Warning, TEXT("Audio: %s имеет неверную структуру строк."), *EventsTable->GetName());
		EventsTable = nullptr;
	}
	if (!EventsTable && !WarnedKeys.Contains(TEXT("DT_AudioEvents")))
	{
		WarnedKeys.Add(TEXT("DT_AudioEvents"));
		UE_LOG(LogRakis, Warning, TEXT("Audio: DT_AudioEvents не найден — события и фоллбек-музыка недоступны."));
	}
}

FString URakisAudioDirector::MusicStateName(ERakisMusicState State)
{
	return StaticEnum<ERakisMusicState>()->GetNameStringByValue(static_cast<int64>(State));
}

FString URakisAudioDirector::ZoneName(ERakisZone Zone)
{
	return StaticEnum<ERakisZone>()->GetNameStringByValue(static_cast<int64>(Zone));
}

USoundBase* URakisAudioDirector::LoadSound(const FString& Path, FName WarnKey)
{
	if (Path.IsEmpty())
	{
		return nullptr;
	}
	const FName CacheKey(*Path);
	if (const TObjectPtr<USoundBase>* Cached = SoundCache.Find(CacheKey))
	{
		return *Cached;
	}
	USoundBase* Sound = Cast<USoundBase>(FSoftObjectPath(Path).TryLoad());
	if (!Sound)
	{
		if (!WarnedKeys.Contains(WarnKey))
		{
			WarnedKeys.Add(WarnKey);
			UE_LOG(LogRakis, Warning, TEXT("Audio: звук '%s' не найден (%s)."), *Path, *WarnKey.ToString());
		}
		return nullptr;
	}
	SoundCache.Add(CacheKey, Sound);
	return Sound;
}

const FRakisAudioEventRow* URakisAudioDirector::FindEventRow(FName EventID) const
{
	return EventsTable ? EventsTable->FindRow<FRakisAudioEventRow>(EventID, TEXT("RakisAudio"), false) : nullptr;
}

USoundBase* URakisAudioDirector::PickSoundForTrigger(const FString& Trigger, float* OutVolume)
{
	if (!EventsTable)
	{
		return nullptr;
	}
	const FName TriggerName(*Trigger);
	const FRakisAudioEventRow* Best = nullptr;
	for (const TPair<FName, uint8*>& Pair : EventsTable->GetRowMap())
	{
		const FRakisAudioEventRow* Row = reinterpret_cast<const FRakisAudioEventRow*>(Pair.Value);
		if (Row && Row->Trigger == TriggerName && (!Best || Row->Priority > Best->Priority))
		{
			Best = Row;
		}
	}
	if (!Best)
	{
		return nullptr;
	}
	if (OutVolume)
	{
		*OutVolume = Best->Volume;
	}
	return LoadSound(Best->Asset, TriggerName);
}

void URakisAudioDirector::PostEvent(FName EventID, const FVector& Location)
{
	LoadData();
	const FRakisAudioEventRow* Row = FindEventRow(EventID);
	if (!Row)
	{
		if (!WarnedKeys.Contains(EventID))
		{
			WarnedKeys.Add(EventID);
			UE_LOG(LogRakis, Warning, TEXT("Audio: событие '%s' отсутствует в DT_AudioEvents."), *EventID.ToString());
		}
		return;
	}

	USoundBase* Sound = LoadSound(Row->Asset, EventID);
	if (!Sound)
	{
		return;
	}

	if (Row->Is2D)
	{
		UGameplayStatics::PlaySound2D(this, Sound, Row->Volume);
		return;
	}

	USoundAttenuation* Attenuation = nullptr;
	if (!Row->Attenuation.IsEmpty())
	{
		const FName AttKey(*Row->Attenuation);
		if (const TObjectPtr<USoundAttenuation>* Cached = AttenuationCache.Find(AttKey))
		{
			Attenuation = *Cached;
		}
		else
		{
			Attenuation = Cast<USoundAttenuation>(FSoftObjectPath(Row->Attenuation).TryLoad());
			if (!Attenuation && !WarnedKeys.Contains(AttKey))
			{
				WarnedKeys.Add(AttKey);
				UE_LOG(LogRakis, Warning, TEXT("Audio: затухание '%s' не найдено — используется затухание из ассета."), *Row->Attenuation);
			}
			AttenuationCache.Add(AttKey, Attenuation);
		}
	}
	UGameplayStatics::SpawnSoundAtLocation(this, Sound, Location, FRotator::ZeroRotator, Row->Volume, 1.f, 0.f, Attenuation);
}

// ---------------------------------------------------------------------------------------------
// Музыка
// ---------------------------------------------------------------------------------------------

void URakisAudioDirector::SetMusicState(ERakisMusicState NewState)
{
	const bool bWormState = NewState == ERakisMusicState::WormThreat || NewState == ERakisMusicState::WormReveal;
	const float Now = GetWorld() ? GetWorld()->GetTimeSeconds() : 0.f;

	if (bInAutoThreat)
	{
		if (bWormState)
		{
			// Червь-состояние поверх авто-угрозы: возврат к PreThreatState сохраняется.
			ThreatEnteredTime = Now;
		}
		else if (NewState != ERakisMusicState::Silence)
		{
			// Пока звучит угроза, «спокойные» запросы (смена зоны) лишь меняют состояние возврата.
			PreThreatState = NewState;
			return;
		}
		else
		{
			bInAutoThreat = false;
		}
	}
	else if (bWormState && bAutoWormMusic)
	{
		// Явный WormThreat/WormReveal (StoryDirector, кат-сцена) тоже возвращается сам, когда угроза спадёт.
		if (!RakisAudio::IsProtectedState(MusicState) || !bMusicStarted)
		{
			PreThreatState = bMusicStarted ? MusicState : ERakisMusicState::DesertCalm;
		}
		bInAutoThreat = true;
		ThreatEnteredTime = Now;
	}

	if (NewState == MusicState && bMusicStarted)
	{
		return;
	}
	const ERakisMusicState Old = MusicState;
	MusicState = NewState;
	ApplyMusicState(Old);
}

void URakisAudioDirector::ApplyMusicState(ERakisMusicState OldState)
{
	LoadData();
	bMusicStarted = true;

	UE_LOG(LogRakis, Log, TEXT("Audio: музыка %s -> %s"), *MusicStateName(OldState), *MusicStateName(MusicState));

	EnsureAdaptiveMusic();
	if (AdaptiveMusic)
	{
		AdaptiveMusic->SetIntParameter(RakisAudio::ParamStateIndex, static_cast<int32>(MusicState));
	}
	else
	{
		CrossfadeMusicTo(MusicState);
	}

	if (OldState != MusicState)
	{
		OnMusicStateChanged.Broadcast(OldState, MusicState);
	}
}

void URakisAudioDirector::EnsureAdaptiveMusic()
{
	if (AdaptiveMusic || bAdaptiveMissing)
	{
		return;
	}
	USoundBase* Sound = Cast<USoundBase>(AdaptiveMusicPath.TryLoad());
	if (!Sound)
	{
		bAdaptiveMissing = true;
		UE_LOG(LogRakis, Warning, TEXT("Audio: %s не найден — музыка в режиме кроссфейда по DT_AudioEvents (Music.<State>)."), *AdaptiveMusicPath.ToString());
		return;
	}
	AdaptiveMusic = UGameplayStatics::CreateSound2D(this, Sound, MusicVolume, 1.f, 0.f, nullptr, /*bPersistAcrossLevelTransition*/ false, /*bAutoDestroy*/ false);
	if (!AdaptiveMusic)
	{
		// Нет аудиоустройства (-nosound, сервер) — молча работаем без музыки.
		bAdaptiveMissing = true;
		return;
	}
	AdaptiveMusic->SetIntParameter(RakisAudio::ParamStateIndex, static_cast<int32>(MusicState));
	AdaptiveMusic->SetFloatParameter(RakisAudio::ParamIntensity, SmoothedIntensity);
	AdaptiveMusic->SetFloatParameter(RakisAudio::ParamWormThreat, SmoothedThreat);
	AdaptiveMusic->SetFloatParameter(RakisAudio::ParamInterior, SmoothedInterior);
	AdaptiveMusic->FadeIn(MusicFadeIn, 1.f);
}

void URakisAudioDirector::CrossfadeMusicTo(ERakisMusicState State)
{
	// Затухающий «позапрошлый» трек — убираем сразу.
	RakisAudio::StopAndDestroy(MusicB);
	MusicB = MusicA;
	MusicA = nullptr;
	if (MusicB)
	{
		MusicB->FadeOut(MusicFadeOut, 0.f);
	}

	if (State == ERakisMusicState::Silence)
	{
		return;
	}

	float RowVolume = 1.f;
	USoundBase* Sound = PickSoundForTrigger(FString::Printf(TEXT("Music.%s"), *MusicStateName(State)), &RowVolume);
	if (!Sound)
	{
		const FName Key(*FString::Printf(TEXT("Music.%s"), *MusicStateName(State)));
		if (!WarnedKeys.Contains(Key))
		{
			WarnedKeys.Add(Key);
			UE_LOG(LogRakis, Warning, TEXT("Audio: нет строки DT_AudioEvents с Trigger=%s — тишина."), *Key.ToString());
		}
		return;
	}
	MusicA = UGameplayStatics::CreateSound2D(this, Sound, MusicVolume * RowVolume, 1.f, 0.f, nullptr, false, false);
	if (MusicA)
	{
		MusicA->FadeIn(MusicFadeIn, 1.f);
	}
}

void URakisAudioDirector::UpdateMusicParams(float DeltaTime)
{
	const float Alpha = FMath::Clamp(DeltaTime * ParamSmoothing, 0.f, 1.f);

	float Storm = 0.f;
	if (const URakisWeatherSubsystem* Weather = GetWorld() ? GetWorld()->GetSubsystem<URakisWeatherSubsystem>() : nullptr)
	{
		Storm = Weather->GetStormIntensity();
	}
	const float TargetIntensity = FMath::Clamp(FMath::Max3(WormThreat, Storm * 0.6f, IntensityOverride), 0.f, 1.f);

	SmoothedThreat = FMath::Lerp(SmoothedThreat, WormThreat, Alpha);
	SmoothedIntensity = FMath::Lerp(SmoothedIntensity, TargetIntensity, Alpha);
	SmoothedInterior = FMath::Lerp(SmoothedInterior, InteriorTarget, Alpha);

	if (AdaptiveMusic)
	{
		AdaptiveMusic->SetFloatParameter(RakisAudio::ParamIntensity, SmoothedIntensity);
		AdaptiveMusic->SetFloatParameter(RakisAudio::ParamWormThreat, SmoothedThreat);
		AdaptiveMusic->SetFloatParameter(RakisAudio::ParamInterior, SmoothedInterior);
	}
}

void URakisAudioDirector::SetInterior(bool bInterior)
{
	InteriorTarget = bInterior ? 1.f : 0.f;
}

// ---------------------------------------------------------------------------------------------
// Эмбиент и реверб
// ---------------------------------------------------------------------------------------------

void URakisAudioDirector::SetAmbienceZone(ERakisZone Zone)
{
	LoadData();
	if (Zone == AmbienceZone && AmbienceCurrent)
	{
		return;
	}
	AmbienceZone = Zone;

	const FString ZoneStr = ZoneName(Zone);
	const bool bSietch = ZoneStr.StartsWith(TEXT("B"));

	float RowVolume = 1.f;
	FString Key = FString::Printf(TEXT("Amb.%s"), *ZoneStr);
	USoundBase* Sound = PickSoundForTrigger(Key, &RowVolume);
	if (!Sound)
	{
		Key = bSietch ? TEXT("Amb.Sietch") : TEXT("Amb.Desert");
		Sound = PickSoundForTrigger(Key, &RowVolume);
	}
	if (!Sound)
	{
		const FSoftObjectPath& Path = bSietch ? SietchAmbiencePath : DesertAmbiencePath;
		Key = Path.ToString();
		RowVolume = 1.f;
		Sound = LoadSound(Key, FName(*Key));
	}

	// Тот же бед (напр. B1→B2 без своего эмбиента) — не перезапускаем.
	if (Key == AmbienceKey && AmbienceCurrent)
	{
		return;
	}
	AmbienceKey = Key;

	RakisAudio::StopAndDestroy(AmbiencePrevious);
	AmbiencePrevious = AmbienceCurrent;
	AmbienceCurrent = nullptr;
	if (AmbiencePrevious)
	{
		AmbiencePrevious->FadeOut(AmbienceCrossfade, 0.f);
	}

	if (Sound)
	{
		AmbienceCurrent = UGameplayStatics::CreateSound2D(this, Sound, AmbienceVolume * RowVolume, 1.f, 0.f, nullptr, false, false);
		if (AmbienceCurrent)
		{
			AmbienceCurrent->FadeIn(AmbienceCrossfade, 1.f);
		}
	}
}

void URakisAudioDirector::SetZoneReverb(UReverbEffect* Reverb)
{
	if (Reverb == ActiveReverb)
	{
		return;
	}
	if (ActiveReverb)
	{
		UGameplayStatics::DeactivateReverbEffect(this, RakisAudio::ZoneReverbTag);
	}
	ActiveReverb = Reverb;
	if (Reverb)
	{
		UGameplayStatics::ActivateReverbEffect(this, Reverb, RakisAudio::ZoneReverbTag, /*Priority*/ 1.f, /*Volume*/ 0.6f, ReverbFadeTime);
	}
}

// ---------------------------------------------------------------------------------------------
// Червь
// ---------------------------------------------------------------------------------------------

ARakisWorm* URakisAudioDirector::FindWorm()
{
	if (ARakisWorm* W = Worm.Get())
	{
		return W;
	}
	UWorld* World = GetWorld();
	if (!World || World->GetTimeSeconds() < NextWormSearchTime)
	{
		return nullptr;
	}
	NextWormSearchTime = World->GetTimeSeconds() + 2.f;

	for (TActorIterator<ARakisWorm> It(World); It; ++It)
	{
		ARakisWorm* Found = *It;
		if (IsValid(Found))
		{
			Worm = Found;
			Found->OnWormStateChanged.AddUniqueDynamic(this, &URakisAudioDirector::HandleWormStateChanged);
			return Found;
		}
	}
	return nullptr;
}

void URakisAudioDirector::HandleWormStateChanged(ERakisWormState OldState, ERakisWormState NewState)
{
	if (!bAutoWormMusic)
	{
		return;
	}
	// Выход на поверхность — удар WormReveal (если StoryDirector/кат-сцена ещё не поставили его сами).
	if (NewState == ERakisWormState::Surface && MusicState != ERakisMusicState::WormReveal)
	{
		if (!bInAutoThreat)
		{
			PreThreatState = MusicState;
		}
		bInAutoThreat = true;
		ThreatEnteredTime = GetWorld() ? GetWorld()->GetTimeSeconds() : 0.f;
		const ERakisMusicState Old = MusicState;
		MusicState = ERakisMusicState::WormReveal;
		ApplyMusicState(Old);
	}
}

void URakisAudioDirector::UpdateWorm()
{
	const ARakisWorm* W = FindWorm();
	WormThreat = W ? FMath::Clamp(W->GetThreat01(), 0.f, 1.f) : 0.f;

	if (!bAutoWormMusic || !bMusicStarted)
	{
		return;
	}
	const float Now = GetWorld() ? GetWorld()->GetTimeSeconds() : 0.f;

	if (!bInAutoThreat)
	{
		if (WormThreat > ThreatEnter && !RakisAudio::IsProtectedState(MusicState))
		{
			PreThreatState = MusicState;
			bInAutoThreat = true;
			ThreatEnteredTime = Now;
			const ERakisMusicState Old = MusicState;
			MusicState = ERakisMusicState::WormThreat;
			ApplyMusicState(Old);
		}
	}
	else if (WormThreat < ThreatExit
		&& Now - ThreatEnteredTime > (MusicState == ERakisMusicState::WormReveal ? RevealHoldSeconds : ThreatHoldSeconds))
	{
		bInAutoThreat = false;
		const ERakisMusicState Old = MusicState;
		MusicState = PreThreatState;
		ApplyMusicState(Old);
	}
}

void URakisAudioDirector::Tick(float DeltaTime)
{
	UWorld* World = GetWorld();
	if (!World || !World->HasBegunPlay())
	{
		return;
	}

	UpdateAccumulator += DeltaTime;
	const float Step = 1.f / FMath::Max(UpdateHz, 1.f);
	if (UpdateAccumulator < Step)
	{
		return;
	}
	const float Elapsed = UpdateAccumulator;
	UpdateAccumulator = 0.f;

	UpdateWorm();
	UpdateMusicParams(Elapsed);
}
