#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "Core/RakisTypes.h"
#include "Core/RakisDataTypes.h"
#include "RakisCrowdSubsystem.generated.h"

class ARakisCitizen;
class ARakisCompanion;
class UDataTable;
class ULevel;

/** Ритуал начался (толпа потянулась в зал B5). */
DECLARE_DYNAMIC_MULTICAST_DELEGATE(FRakisOnRitualStarted);

/**
 * Реестр толпы сиетча (контракт §2.2 AI/).
 * - Регистрация горожан, кэш архетипов DT_CrowdArchetypes (+ встроенные 8 архетипов, если таблицы нет).
 * - «Smart-Object-подобные» точки: акторы с тегом Rakis.SmartObject.<Type>, резервирование с ёмкостью.
 * - Реестр разговоров: группы у одной точки умолкают, когда игрок ближе SilenceRadius, и продолжают после.
 * - Арбитраж лая (не чаще MinGlobalBarkInterval на всю толпу).
 * - StartRitual(): все горожане — к точкам Rakis.HallGather по кругу со ступенчатыми задержками.
 * - Автозапуск ритуала по docs/06 §1.3 (вход в B3 или 4 мин в B2), CVar Rakis.Crowd.AutoRitual.
 * - Автоспавн спутников у маркеров Rakis.Companion.<Id>, если их нет на уровне (CVar Rakis.Companions.AutoSpawn).
 */
UCLASS(Config = Game)
class RAKIS_API URakisCrowdSubsystem : public UWorldSubsystem
{
	GENERATED_BODY()

public:
	static URakisCrowdSubsystem* Get(const UObject* WorldContextObject);

	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;
	virtual void OnWorldBeginPlay(UWorld& InWorld) override;

	/** Все горожане — к точкам Rakis.HallGather. Повторный вызов игнорируется. */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Crowd")
	void StartRitual();

	UFUNCTION(BlueprintPure, Category = "Rakis|Crowd")
	bool IsRitualStarted() const { return bRitualStarted; }

	/** Центр зала (среднее точек сбора); false — точек нет. */
	UFUNCTION(BlueprintPure, Category = "Rakis|Crowd")
	bool GetHallCentre(FVector& OutCentre) const;

	UFUNCTION(BlueprintPure, Category = "Rakis|Crowd")
	int32 GetNumCitizens() const { return Citizens.Num(); }

	UPROPERTY(BlueprintAssignable, Category = "Rakis|Crowd")
	FRakisOnRitualStarted OnRitualStarted;

	// --- Горожане ---
	void RegisterCitizen(ARakisCitizen* Citizen);
	void UnregisterCitizen(ARakisCitizen* Citizen);

	// --- Архетипы ---
	/** Строка архетипа (DataTable или встроенная), nullptr — нет такого. */
	const FRakisCrowdArchetypeRow* FindArchetype(FName Archetype) const;
	/** Все архетипы и их SpawnWeight (в стабильном порядке — для детерминированного спавна). */
	void GetArchetypeWeights(TArray<FName>& OutNames, TArray<float>& OutWeights) const;
	/** Типы точек архетипа (SmartObjectTags через ';', с алиасами Prayer→PrayerMat и т.п.). */
	TArray<FName> GetArchetypeSpotTypes(FName Archetype) const;

	// --- Точки ---
	/** Зарезервировать свободную точку одного из типов рядом с Near. */
	AActor* ReserveSpot(ARakisCitizen* User, const TArray<FName>& Types, const FVector& Near, float MaxDistance, FRandomStream& Rng, FName& OutType);
	void ReleaseSpot(ARakisCitizen* User, AActor* Spot);
	/** Сколько горожан уже на точке. */
	int32 GetSpotOccupancy(const AActor* Spot) const;

	// --- Разговоры и лай ---
	void SetTalking(ARakisCitizen* Citizen, bool bTalking);
	/** Захватить «окно» для лая; false — кто-то недавно говорил. */
	bool TryAcquireBarkSlot();

	// ---------- Тюнинг ([/Script/Rakis.RakisCrowdSubsystem]) ----------

	/** Радиус, в котором разговор умолкает при приближении игрока, см. */
	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Crowd|Conversation")
	float SilenceRadius = 400.f;

	/** Радиус возобновления (гистерезис), см. */
	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Crowd|Conversation")
	float ResumeRadius = 550.f;

	/** Задержка возобновления разговора после ухода игрока, сек. */
	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Crowd|Conversation")
	float ResumeDelay = 1.5f;

	/** Частота обновления реестра разговоров, Гц. */
	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Crowd|Conversation")
	float ConversationUpdateHz = 4.f;

	/** Минимальный интервал между звуками «разговор стих» (Crowd:PlayerNear), сек. */
	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Crowd|Conversation")
	float HushSoundCooldown = 12.f;

	/** Минимальный интервал между любыми двумя репликами толпы, сек. */
	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Crowd|Barks")
	float MinGlobalBarkInterval = 3.5f;

	/** Ритуал: задержка перед первым, шаг между горожанами и случайный разброс, сек. */
	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Crowd|Ritual")
	float RitualStartDelay = 0.5f;

	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Crowd|Ritual")
	float RitualStaggerStep = 0.35f;

	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Crowd|Ritual")
	float RitualStaggerJitter = 1.5f;

	/** Разнос горожан вокруг одной точки сбора (кольца), см. */
	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Crowd|Ritual")
	float GatherRingSpacing = 90.f;

	/** Автозапуск ритуала через N сек в B2 (docs/06 §1.3). */
	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Crowd|Ritual")
	float AutoRitualGallerySeconds = 240.f;

	/** Класс для автоспавна спутников (BP-наследник ARakisCompanion). Пусто — ARakisCompanion. */
	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Crowd|Companions")
	TSoftClassPtr<ARakisCompanion> CompanionClass;

protected:
	virtual bool DoesSupportWorldType(const EWorldType::Type WorldType) const override;

private:
	void LoadArchetypes();
	void BuildBuiltInArchetypes();
	void RebuildSpotCache();
	void HandleLevelAddedToWorld(ULevel* InLevel, UWorld* InWorld);
	void UpdateConversations();
	void TickAutoRitual();
	void SpawnMissingCompanions();
	static int32 GetSpotCapacity(FName Type);

	UFUNCTION()
	void HandleZoneChanged(ERakisZone OldZone, ERakisZone NewZone);

	UPROPERTY(Transient)
	TObjectPtr<UDataTable> ArchetypeTable;

	TMap<FName, FRakisCrowdArchetypeRow> BuiltInArchetypes;

	TArray<TWeakObjectPtr<ARakisCitizen>> Citizens;

	/** Тип точки → акторы. */
	TMap<FName, TArray<TWeakObjectPtr<AActor>>> SpotsByType;
	/** Точка → тип (для ёмкости). */
	TMap<TWeakObjectPtr<AActor>, FName> SpotTypes;
	/** Точка → кто на ней. */
	TMap<TWeakObjectPtr<AActor>, TArray<TWeakObjectPtr<ARakisCitizen>>> SpotUsers;
	bool bSpotCacheDirty = true;

	TSet<TWeakObjectPtr<ARakisCitizen>> Talking;
	/** Группа (точка или сам горожанин) → время, когда игрок отошёл. */
	TMap<TWeakObjectPtr<AActor>, float> GroupClearSince;
	TSet<TWeakObjectPtr<AActor>> SilencedGroups;

	float LastBarkTime = -1000.f;
	float NextHushSoundTime = 0.f;
	bool bRitualStarted = false;
	bool bWarnedNoGather = false;
	bool bWarnedNoTable = false;

	FTimerHandle ConversationTimer;
	FTimerHandle AutoRitualTimer;
	FDelegateHandle LevelAddedHandle;
};
