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
#include "GameFramework/Pawn.h"
#include "EngineUtils.h"
#include "Kismet/GameplayStatics.h"
#include "Sound/ReverbEffect.h"
#include "Sound/SoundAttenuation.h"
#include "Sound/SoundBase.h"

namespace RakisAudioDirectorPrivate
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
	RakisAudioDirectorPrivate::StopAndDestroy(AdaptiveMusic);
	RakisAudioDirectorPrivate::StopAndDestroy(MusicA);
	RakisAudioDirectorPrivate::StopAndDestroy(MusicB);
	RakisAudioDirectorPrivate::StopAndDestroy(AmbienceCurrent);
	RakisAudioDirectorPrivate::StopAndDestroy(AmbiencePrevious);
	RakisAudioDirectorPrivate::StopAndDestroy(WeatherLayer);
	RakisAudioDirectorPrivate::StopAndDestroy(WeatherLayerPrevious);
	AdaptiveMusic = MusicA = MusicB = AmbienceCurrent = AmbiencePrevious = WeatherLayer = WeatherLayerPrevious = nullptr;
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

	if (URakisWeatherSubsystem* Weather = InWorld.GetSubsystem<URakisWeatherSubsystem>())
	{
		Weather->OnPresetChanged.AddUniqueDynamic(this, &URakisAudioDirector::HandleWeatherPresetChanged);
		SetWeatherLayer(Weather->GetCurrentPreset());
	}
}

void URakisAudioDirector::HandleWeatherPresetChanged(FName PresetId)
{
	SetWeatherLayer(PresetId);
}

void URakisAudioDirector::SetWeatherLayer(FName PresetId)
{
	LoadData();
	const FRakisAudioEventRow* Row = PresetId.IsNone() ? nullptr
		: FindRowFlexible(FString::Printf(TEXT("Weather:%s"), *PresetId.ToString()), FString(), /*bRequire2D*/ true);
	const FString NewKey = Row ? Row->Asset : FString();
	if (NewKey == WeatherLayerKey)
	{
		return;
	}
	WeatherLayerKey = NewKey;

	RakisAudioDirectorPrivate::StopAndDestroy(WeatherLayerPrevious);
	WeatherLayerPrevious = WeatherLayer;
	WeatherLayer = nullptr;
	if (WeatherLayerPrevious)
	{
		WeatherLayerPrevious->FadeOut(WeatherLayerCrossfade, 0.f);
	}
	if (Row)
	{
		if (USoundBase* Sound = LoadSound(Row->Asset, FName(*FString::Printf(TEXT("Weather:%s"), *PresetId.ToString()))))
		{
			WeatherLayer = UGameplayStatics::CreateSound2D(this, Sound, Row->Volume, 1.f, 0.f, nullptr, false, false);
			if (WeatherLayer)
			{
				WeatherLayer->FadeIn(WeatherLayerCrossfade, 1.f);
			}
		}
	}
}

void URakisAudioDirector::UpdateGusts()
{
	const UWorld* World = GetWorld();
	const URakisWeatherSubsystem* Weather = World ? World->GetSubsystem<URakisWeatherSubsystem>() : nullptr;
	if (!Weather)
	{
		return;
	}
	const float Base = FMath::Max(Weather->GetCurrentValues().WindSpeed, 0.5f);
	const bool bHigh = Weather->GetWindSpeed() / Base > GustRatioThreshold;
	const float Now = World->GetTimeSeconds();

	// Передний фронт порыва, снаружи, не чаще GustCooldown.
	if (bHigh && !bGustHigh && Now >= NextGustTime && Weather->GetInterior01() < 0.5f)
	{
		NextGustTime = Now + GustCooldown;
		const APawn* Player = UGameplayStatics::GetPlayerPawn(this, 0);
		PostEventByTrigger(TEXT("Weather:Gust"), Player ? Player->GetActorLocation() : FVector::ZeroVector);
	}
	bGustHigh = bHigh;
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

const FRakisAudioEventRow* URakisAudioDirector::FindRowFlexible(const FString& Key, const FString& AltTrigger, bool bRequire2D) const
{
	if (!EventsTable)
	{
		return nullptr;
	}
	// 1) По имени строки (EventID).
	if (const FRakisAudioEventRow* ByName = EventsTable->FindRow<FRakisAudioEventRow>(FName(*Key), TEXT("RakisAudio"), false))
	{
		if (!bRequire2D || ByName->Is2D)
		{
			return ByName;
		}
	}
	// 2) По полю Trigger.
	const FName KeyName(*Key);
	const FName AltName = AltTrigger.IsEmpty() ? NAME_None : FName(*AltTrigger);
	const FRakisAudioEventRow* Best = nullptr;
	for (const TPair<FName, uint8*>& Pair : EventsTable->GetRowMap())
	{
		const FRakisAudioEventRow* Row = reinterpret_cast<const FRakisAudioEventRow*>(Pair.Value);
		if (!Row || (bRequire2D && !Row->Is2D))
		{
			continue;
		}
		const bool bMatch = Row->Trigger == KeyName || (!AltName.IsNone() && Row->Trigger == AltName);
		if (bMatch && (!Best || Row->Priority > Best->Priority))
		{
			Best = Row;
		}
	}
	return Best;
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
	PlayRow(*Row, EventID, Location);
}

bool URakisAudioDirector::PostEventByTrigger(FName Trigger, const FVector& Location)
{
	LoadData();
	const FRakisAudioEventRow* Row = FindRowFlexible(Trigger.ToString(), FString(), false);
	if (!Row)
	{
		return false;
	}
	PlayRow(*Row, Trigger, Location);
	return true;
}

void URakisAudioDirector::PlayRow(const FRakisAudioEventRow& Row, FName WarnKey, const FVector& Location)
{
	USoundBase* Sound = LoadSound(Row.Asset, WarnKey);
	if (!Sound)
	{
		return;
	}

	if (Row.Is2D)
	{
		UGameplayStatics::PlaySound2D(this, Sound, Row.Volume);
		return;
	}

	USoundAttenuation* Attenuation = nullptr;
	if (!Row.Attenuation.IsEmpty())
	{
		const FName AttKey(*Row.Attenuation);
		if (const TObjectPtr<USoundAttenuation>* Cached = AttenuationCache.Find(AttKey))
		{
			Attenuation = *Cached;
		}
		else
		{
			Attenuation = Cast<USoundAttenuation>(FSoftObjectPath(Row.Attenuation).TryLoad());
			if (!Attenuation && !WarnedKeys.Contains(AttKey))
			{
				WarnedKeys.Add(AttKey);
				UE_LOG(LogRakis, Warning, TEXT("Audio: затухание '%s' не найдено — используется затухание из ассета."), *Row.Attenuation);
			}
			AttenuationCache.Add(AttKey, Attenuation);
		}
	}
	UGameplayStatics::SpawnSoundAtLocation(this, Sound, Location, FRotator::ZeroRotator, Row.Volume, 1.f, 0.f, Attenuation);
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
		if (!RakisAudioDirectorPrivate::IsProtectedState(MusicState) || !bMusicStarted)
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
		AdaptiveMusic->SetIntParameter(RakisAudioDirectorPrivate::ParamStateIndex, static_cast<int32>(MusicState));
		// Громкость состояния из строки "Music.<State>" (Silence = 0) — плавно.
		const FString StateName = MusicStateName(MusicState);
		const FRakisAudioEventRow* Row = FindRowFlexible(FString::Printf(TEXT("Music.%s"), *StateName), FString::Printf(TEXT("Music:%s"), *StateName), false);
		const float StateVolume = Row ? Row->Volume : (MusicState == ERakisMusicState::Silence ? 0.f : 1.f);
		AdaptiveMusic->AdjustVolume(MusicFadeOut, FMath::Max(StateVolume, 0.001f));
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
	AdaptiveMusic->SetIntParameter(RakisAudioDirectorPrivate::ParamStateIndex, static_cast<int32>(MusicState));
	AdaptiveMusic->SetFloatParameter(RakisAudioDirectorPrivate::ParamIntensity, SmoothedIntensity);
	AdaptiveMusic->SetFloatParameter(RakisAudioDirectorPrivate::ParamWormThreat, SmoothedThreat);
	AdaptiveMusic->SetFloatParameter(RakisAudioDirectorPrivate::ParamInterior, SmoothedInterior);
	AdaptiveMusic->FadeIn(MusicFadeIn, 1.f);
}

void URakisAudioDirector::CrossfadeMusicTo(ERakisMusicState State)
{
	// Затухающий «позапрошлый» трек — убираем сразу.
	RakisAudioDirectorPrivate::StopAndDestroy(MusicB);
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

	const FString StateName = MusicStateName(State);
	const FRakisAudioEventRow* Row = FindRowFlexible(FString::Printf(TEXT("Music.%s"), *StateName), FString::Printf(TEXT("Music:%s"), *StateName), false);
	const float RowVolume = Row ? Row->Volume : 1.f;
	USoundBase* Sound = Row ? LoadSound(Row->Asset, FName(*FString::Printf(TEXT("Music.%s"), *StateName))) : nullptr;
	if (!Sound)
	{
		const FName Key(*FString::Printf(TEXT("Music.%s"), *StateName));
		if (!WarnedKeys.Contains(Key))
		{
			WarnedKeys.Add(Key);
			UE_LOG(LogRakis, Warning, TEXT("Audio: нет звука для %s в DT_AudioEvents — тишина."), *Key.ToString());
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
		AdaptiveMusic->SetFloatParameter(RakisAudioDirectorPrivate::ParamIntensity, SmoothedIntensity);
		AdaptiveMusic->SetFloatParameter(RakisAudioDirectorPrivate::ParamWormThreat, SmoothedThreat);
		AdaptiveMusic->SetFloatParameter(RakisAudioDirectorPrivate::ParamInterior, SmoothedInterior);
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
	USoundBase* Sound = nullptr;
	FString Key = FString::Printf(TEXT("Amb.%s"), *ZoneStr);
	const FRakisAudioEventRow* Row = FindRowFlexible(Key, FString::Printf(TEXT("ZoneEnter:%s"), *ZoneStr), /*bRequire2D*/ true);
	if (!Row)
	{
		Key = bSietch ? TEXT("Amb.Sietch") : TEXT("Amb.Desert");
		Row = FindRowFlexible(Key, FString(), true);
	}
	if (Row)
	{
		RowVolume = Row->Volume;
		Sound = LoadSound(Row->Asset, FName(*Key));
		Key = Row->Asset; // один и тот же бед для разных зон не перезапускается
	}
	if (!Sound)
	{
		const FSoftObjectPath& Path = bSietch ? SietchAmbiencePath : DesertAmbiencePath;
		Key = Path.ToString();
		RowVolume = 1.f;
		Sound = LoadSound(Key, FName(*Key));
	}

	// Тот же бед (A1→A2 — один MS_Amb_Desert) — не перезапускаем, только плавно меняем громкость.
	if (Key == AmbienceKey && AmbienceCurrent)
	{
		AmbienceCurrent->AdjustVolume(AmbienceCrossfade, RowVolume / FMath::Max(AmbienceCreatedRowVolume, 0.01f));
		return;
	}
	AmbienceKey = Key;
	AmbienceCreatedRowVolume = RowVolume;

	RakisAudioDirectorPrivate::StopAndDestroy(AmbiencePrevious);
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
		UGameplayStatics::DeactivateReverbEffect(this, RakisAudioDirectorPrivate::ZoneReverbTag);
	}
	ActiveReverb = Reverb;
	if (Reverb)
	{
		UGameplayStatics::ActivateReverbEffect(this, Reverb, RakisAudioDirectorPrivate::ZoneReverbTag, /*Priority*/ 1.f, /*Volume*/ 0.6f, ReverbFadeTime);
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
		if (WormThreat > ThreatEnter && !RakisAudioDirectorPrivate::IsProtectedState(MusicState))
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
	UpdateGusts();
}
