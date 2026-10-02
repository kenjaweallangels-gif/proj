#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "Core/RakisTypes.h"
#include "RakisAudioDirector.generated.h"

class UAudioComponent;
class UDataTable;
class USoundBase;
class USoundAttenuation;
class UReverbEffect;
class ARakisWorm;
struct FRakisAudioEventRow;

/** Музыкальное состояние сменилось. */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FRakisOnMusicStateChanged, ERakisMusicState, OldState, ERakisMusicState, NewState);

/**
 * Звуковой директор (контракт §2.2 Audio/).
 *
 * Музыка — два режима:
 *  1) MetaSound MS_Music_Adaptive (один UAudioComponent) с параметрами
 *     "StateIndex" (int, = ERakisMusicState), "Intensity", "WormThreat", "Interior" (float 0..1);
 *  2) фоллбек-кроссфейд, если MetaSound отсутствует: строки DT_AudioEvents с Trigger == "Music.<State>"
 *     (напр. "Music.DesertCalm"), два компонента с FadeIn/FadeOut.
 * Эмбиент — бед на зону: Trigger "Amb.<Zone>" (напр. "Amb.A2_Erg"), затем "Amb.Desert"/"Amb.Sietch",
 *  затем MS_Amb_Desert / MS_Amb_Sietch по фиксированным путям.
 * PostEvent(EventID, Location) — строка DT_AudioEvents по имени (Is2D → PlaySound2D, иначе SpawnSoundAtLocation).
 * Червь: при GetThreat01() > ThreatEnter — состояние WormThreat, ниже ThreatExit (с удержанием) — возврат.
 */
UCLASS(Config = Game)
class RAKIS_API URakisAudioDirector : public UTickableWorldSubsystem
{
	GENERATED_BODY()

public:
	static URakisAudioDirector* Get(const UObject* WorldContextObject);

	// USubsystem / UWorldSubsystem
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;
	virtual void OnWorldBeginPlay(UWorld& InWorld) override;

	// FTickableGameObject
	virtual void Tick(float DeltaTime) override;
	virtual TStatId GetStatId() const override;

	/** Сменить музыкальное состояние (зона, StoryDirector, кат-сцены). */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Audio")
	void SetMusicState(ERakisMusicState NewState);

	UFUNCTION(BlueprintPure, Category = "Rakis|Audio")
	ERakisMusicState GetMusicState() const { return MusicState; }

	/** Проиграть событие из DT_AudioEvents. Location игнорируется для Is2D. */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Audio")
	void PostEvent(FName EventID, const FVector& Location);

	/** Эмбиент-бед зоны (вызывает URakisZoneSubsystem). */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Audio")
	void SetAmbienceZone(ERakisZone Zone);

	/** Интерьер для параметра "Interior" музыки (вызывает URakisZoneSubsystem). */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Audio")
	void SetInterior(bool bInterior);

	/** Реверб зоны; nullptr — снять. */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Audio")
	void SetZoneReverb(UReverbEffect* Reverb);

	/** Внешняя «интенсивность» (напр. от StoryDirector), добавляется к вычисленной. */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Audio")
	void SetIntensityOverride(float Intensity01) { IntensityOverride = FMath::Clamp(Intensity01, 0.f, 1.f); }

	/** Разрешить/запретить автопереход в WormThreat (кат-сцены, финал). */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Audio")
	void SetAutoWormMusic(bool bEnabled) { bAutoWormMusic = bEnabled; }

	UPROPERTY(BlueprintAssignable, Category = "Rakis|Audio")
	FRakisOnMusicStateChanged OnMusicStateChanged;

	// ---------- Тюнинг (DefaultGame.ini, [/Script/Rakis.RakisAudioDirector]) ----------

	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Audio|Music")
	FSoftObjectPath AdaptiveMusicPath = FSoftObjectPath(TEXT("/Game/Rakis/Audio/MetaSounds/MS_Music_Adaptive.MS_Music_Adaptive"));

	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Audio|Ambience")
	FSoftObjectPath DesertAmbiencePath = FSoftObjectPath(TEXT("/Game/Rakis/Audio/MetaSounds/MS_Amb_Desert.MS_Amb_Desert"));

	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Audio|Ambience")
	FSoftObjectPath SietchAmbiencePath = FSoftObjectPath(TEXT("/Game/Rakis/Audio/MetaSounds/MS_Amb_Sietch.MS_Amb_Sietch"));

	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Audio|Music")
	float MusicVolume = 0.8f;

	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Audio|Music")
	float MusicFadeIn = 4.f;

	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Audio|Music")
	float MusicFadeOut = 3.f;

	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Audio|Ambience")
	float AmbienceVolume = 1.f;

	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Audio|Ambience")
	float AmbienceCrossfade = 3.f;

	/** Порог угрозы червя для входа в WormThreat. */
	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Audio|Worm")
	float ThreatEnter = 0.35f;

	/** Порог выхода (гистерезис). */
	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Audio|Worm")
	float ThreatExit = 0.2f;

	/** Минимальное время в WormThreat перед возвратом, сек. */
	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Audio|Worm")
	float ThreatHoldSeconds = 6.f;

	/** Минимальное время удержания WormReveal (длина кат-сцены выхода), сек. */
	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Audio|Worm")
	float RevealHoldSeconds = 25.f;

	/** Частота логики директора (опрос червя, параметры), Гц. */
	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Audio")
	float UpdateHz = 10.f;

	/** Сглаживание параметров MetaSound (скорость, 1/с). */
	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Audio|Music")
	float ParamSmoothing = 2.f;

	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Audio|Reverb")
	float ReverbFadeTime = 1.5f;

protected:
	virtual bool DoesSupportWorldType(const EWorldType::Type WorldType) const override;

private:
	void LoadData();
	USoundBase* LoadSound(const FString& Path, FName WarnKey);
	USoundBase* PickSoundForTrigger(const FString& Trigger, float* OutVolume = nullptr);
	const FRakisAudioEventRow* FindEventRow(FName EventID) const;

	void EnsureAdaptiveMusic();
	void ApplyMusicState(ERakisMusicState OldState);
	void CrossfadeMusicTo(ERakisMusicState State);
	void UpdateMusicParams(float DeltaTime);
	void UpdateWorm();
	ARakisWorm* FindWorm();

	UFUNCTION()
	void HandleWormStateChanged(ERakisWormState OldState, ERakisWormState NewState);

	static FString MusicStateName(ERakisMusicState State);
	static FString ZoneName(ERakisZone Zone);

	UPROPERTY(Transient)
	TObjectPtr<UDataTable> EventsTable;

	/** Режим MetaSound: единственный компонент музыки. */
	UPROPERTY(Transient)
	TObjectPtr<UAudioComponent> AdaptiveMusic;

	/** Режим кроссфейда: текущий и затухающий компоненты. */
	UPROPERTY(Transient)
	TObjectPtr<UAudioComponent> MusicA;

	UPROPERTY(Transient)
	TObjectPtr<UAudioComponent> MusicB;

	UPROPERTY(Transient)
	TObjectPtr<UAudioComponent> AmbienceCurrent;

	UPROPERTY(Transient)
	TObjectPtr<UAudioComponent> AmbiencePrevious;

	UPROPERTY(Transient)
	TMap<FName, TObjectPtr<USoundBase>> SoundCache;

	UPROPERTY(Transient)
	TMap<FName, TObjectPtr<USoundAttenuation>> AttenuationCache;

	UPROPERTY(Transient)
	TObjectPtr<UReverbEffect> ActiveReverb;

	TWeakObjectPtr<ARakisWorm> Worm;
	float NextWormSearchTime = 0.f;

	ERakisMusicState MusicState = ERakisMusicState::Silence;
	/** Состояние, к которому вернуться после авто-угрозы. */
	ERakisMusicState PreThreatState = ERakisMusicState::DesertCalm;
	bool bInAutoThreat = false;
	bool bAutoWormMusic = true;
	float ThreatEnteredTime = 0.f;

	ERakisZone AmbienceZone = ERakisZone::None;
	FString AmbienceKey;

	float WormThreat = 0.f;
	float SmoothedThreat = 0.f;
	float SmoothedIntensity = 0.f;
	float SmoothedInterior = 0.f;
	float InteriorTarget = 0.f;
	float IntensityOverride = 0.f;
	float UpdateAccumulator = 0.f;

	bool bAdaptiveMissing = false;
	bool bMusicStarted = false;
	TSet<FName> WarnedKeys;
};
