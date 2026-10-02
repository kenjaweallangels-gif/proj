#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "UObject/SoftObjectPtr.h"
#include "RakisSandTrailSubsystem.generated.h"

class ACharacter;
class ARakisWorm;
class UMaterialInstanceDynamic;
class UMaterialInterface;
class UMaterialParameterCollection;
class UTextureRenderTarget2D;
class URakisNoiseSubsystem;
struct FHitResult;
struct FRakisNoiseEvent;

/** Тип штампа на песке. Значение = параметр StampType материала M_SandTrail_Stamp (SandTrail.ush). */
UENUM(BlueprintType)
enum class ERakisStampType : uint8
{
	Footprint	UMETA(DisplayName = "Footprint"),
	Sliding		UMETA(DisplayName = "Sliding"),
	WormFurrow	UMETA(DisplayName = "Worm Furrow"),
	ThumperRing	UMETA(DisplayName = "Thumper Ring"),
	WormCrater	UMETA(DisplayName = "Worm Crater")
};

/** Один каскад следов: Render Target с окном вокруг игрока, рецентровка шагами Snap со скроллом содержимого. */
USTRUCT()
struct FRakisTrailCascade
{
	GENERATED_BODY()

	/** RT, который читает ландшафт (ассет RT_SandTrail*, либо транзиентный фоллбек). */
	UPROPERTY(Transient)
	TObjectPtr<UTextureRenderTarget2D> Target;

	/** Временный RT того же размера — для скролла при рецентровке (пинг-понг). */
	UPROPERTY(Transient)
	TObjectPtr<UTextureRenderTarget2D> Scratch;

	/** Copy-MID: Target → Scratch со сдвигом UV, и Scratch → Target без сдвига. */
	UPROPERTY(Transient)
	TObjectPtr<UMaterialInstanceDynamic> CopyToScratchMID;

	UPROPERTY(Transient)
	TObjectPtr<UMaterialInstanceDynamic> CopyBackMID;

	UPROPERTY(Transient)
	TObjectPtr<UMaterialInstanceDynamic> FadeMID;

	/** Имя векторного параметра MPC (TrailOrigin / TrailOriginFar). */
	FName MPCParameter;
	float WorldSizeCm = 4096.f;
	int32 Resolution = 2048;
	float SnapCm = 512.f;
	/** Множитель скорости «заживления» (дальний каскад — колея червя — затягивается медленнее). */
	float FadeRateScale = 1.f;
	/** Битовая маска принимаемых ERakisStampType. */
	uint32 AcceptMask = 0;
	FVector2D Origin = FVector2D::ZeroVector;
	bool bHasOrigin = false;
	bool bValid = false;

	float GetTexelCm() const { return WorldSizeCm / static_cast<float>(FMath::Max(Resolution, 1)); }
	bool Accepts(ERakisStampType Type) const { return (AcceptMask & (1u << static_cast<uint32>(Type))) != 0; }
};

/**
 * Деформация песка: следы ног (игрок, спутники, горожане), скольжение, кольцо тампера, колея и кратер червя.
 *
 * Два каскада Render Target (RG16f: R — глубина вмятины, см; G — высота вала, см):
 *   ближний RT_SandTrail      2048² × 40.96 м (2 см/тексель)  — следы ног, скольжение, тампер;
 *   дальний RT_SandTrail_Far  1024² × 204.8 м (20 см/тексель) — колея/кратер червя, тампер.
 * Окно каскада идёт за игроком шагами Snap (кратно текселю); при рецентровке содержимое скроллится
 * копией через второй RT (M_SandTrail_Copy), MPC_RakisWeather.TrailOrigin/TrailOriginFar обновляются.
 * Штампы копятся за кадр и рисуются одним BeginDrawCanvasToRenderTarget на каскад (M_SandTrail_Stamp,
 * Additive, процедурная форма — без текстур; по MID из пула на штамп). Каждые FadeInterval секунд —
 * «заживление ветром» (M_SandTrail_Fade, скорость от MPC WindSpeed/StormIntensity).
 *
 * Источники (только публичное API других систем):
 *   - URakisNoiseSubsystem::OnNoiseReported: "Footstep" → след, "Thumper" → кольцо;
 *   - скан ACharacter в радиусе ScanRadiusCm с частотой ScanHz: шаг ≥ NpcStepCm → след (кто не шлёт шум);
 *   - ARakisWorm (TActorIterator): Approach/Pass/Ridden/Surface → колея по пути головы, вход в Surface → кратер.
 * Ландшафт: M_Landscape_Sand (UseTrails) — docs/tech-art/sand.md §4.
 * Консоль: Rakis.SandTrails 0/1, Rakis.SandTrails.Clear.
 */
UCLASS(Config = Game)
class RAKIS_API URakisSandTrailSubsystem : public UTickableWorldSubsystem
{
	GENERATED_BODY()

public:
	URakisSandTrailSubsystem();

	/** Доступ из любого объекта мира. nullptr в редакторном мире / на выделенном сервере. */
	static URakisSandTrailSubsystem* Get(const UObject* WorldContextObject);

	// USubsystem / UWorldSubsystem
	virtual bool ShouldCreateSubsystem(UObject* Outer) const override;
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;
	virtual void OnWorldBeginPlay(UWorld& InWorld) override;

	// FTickableGameObject
	virtual void Tick(float DeltaTime) override;
	virtual TStatId GetStatId() const override;

	/**
	 * Поставить штамп (рисуется в конце кадра).
	 * @param WorldPos  мировая точка (используется XY)
	 * @param RadiusCm  радиус вмятины (для следа ноги — половина длины стопы), см
	 * @param Depth01   сила 0..1 (× глубина типа, см. *DepthCm)
	 * @param YawDeg    направление «носка» (+X формы), градусы мирового yaw
	 */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Sand")
	void AddStamp(const FVector& WorldPos, float RadiusCm, float Depth01, float YawDeg, ERakisStampType Type);

	/** Стереть все следы (кат-сцена, телепорт). */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Sand")
	void ClearTrails();

	/** Хотя бы один каскад готов (материалы и RT загружены). */
	UFUNCTION(BlueprintPure, Category = "Rakis|Sand")
	bool IsActive() const { return bResourcesReady; }

	// --- Чистые функции (тесты: Private/Sand/RakisSandTrailTests.cpp) ---

	/** Мировая XY → пиксель RT (непрерывные координаты, 0..Resolution). То же отображение, что SandTrail.ush. */
	static FVector2D WorldToPixel(const FVector2D& World, const FVector2D& Origin, float WorldSizeCm, int32 Resolution);

	/** Шаг рецентровки, кратный текселю (минимум 1 тексель). */
	static float SnapToTexel(float SnapCm, float TexelCm);

	/** Центр окна: Focus, округлённый к сетке SnapCm. */
	static FVector2D ComputeSnappedOrigin(const FVector2D& Focus, float SnapCm);

	/** Нужна ли рецентровка: фокус ушёл от центра дальше SnapCm по любой оси (гистерезис — без дрожания). */
	static bool NeedsRecenter(const FVector2D& Focus, const FVector2D& Origin, float SnapCm);

	/** Доля «стирания» за Dt: 1 - exp(-Rate·Dt), Rate = ln2/CalmHalfLife·(1 + Wind/WindRef) + Storm·ln2/StormHalfLife. */
	static float ComputeFadeAlpha(float DeltaSeconds, float WindSpeed, float StormIntensity, float InCalmHalfLifeSec,
		float InWindReferenceMs, float InStormHalfLifeSec);

	/** Песок ли под точкой: теги Rakis.Surface.*, Physical Surface 1/6, иначе ландшафт = песок. 0 — нет, 1 — рыхлый, 2 — плотный. */
	static int32 ClassifySandHit(const FHitResult& Hit);

protected:
	virtual bool DoesSupportWorldType(const EWorldType::Type WorldType) const override;

	// --- Ассеты (создаёт Tools/unreal_python/mat_sand_trails.py) ---
	UPROPERTY(Config)
	TSoftObjectPtr<UTextureRenderTarget2D> NearTargetAsset;

	UPROPERTY(Config)
	TSoftObjectPtr<UTextureRenderTarget2D> FarTargetAsset;

	UPROPERTY(Config)
	TSoftObjectPtr<UMaterialInterface> StampMaterialAsset;

	UPROPERTY(Config)
	TSoftObjectPtr<UMaterialInterface> FadeMaterialAsset;

	UPROPERTY(Config)
	TSoftObjectPtr<UMaterialInterface> CopyMaterialAsset;

	// --- Каскады ---
	UPROPERTY(Config) float NearWorldSizeCm = 4096.f;
	UPROPERTY(Config) float FarWorldSizeCm = 20480.f;
	/** Разрешение транзиентного фоллбека (если ассета RT нет). У ассета берётся его SizeX. */
	UPROPERTY(Config) int32 NearFallbackResolution = 2048;
	UPROPERTY(Config) int32 FarFallbackResolution = 1024;
	UPROPERTY(Config) float NearSnapCm = 512.f;
	UPROPERTY(Config) float FarSnapCm = 2560.f;
	/** Штамп меньше этого (в текселях) в каскад не рисуется. */
	UPROPERTY(Config) float MinStampTexels = 1.5f;
	UPROPERTY(Config) int32 MaxStampsPerFrame = 128;

	// --- Заживление ветром ---
	UPROPERTY(Config) float FadeInterval = 0.25f;
	/** Полураспад следа в штиль, с. */
	UPROPERTY(Config) float CalmHalfLifeSec = 120.f;
	/** Ветер этой силы (м/с) удваивает скорость заживления. */
	UPROPERTY(Config) float WindReferenceMs = 6.f;
	/** Полураспад при StormIntensity = 1 (добавляется к ветровому), с. */
	UPROPERTY(Config) float StormHalfLifeSec = 8.f;
	UPROPERTY(Config) float FarFadeRateScale = 0.5f;

	// --- Глубина типов при Depth01 = 1, см (суммируются аддитивно; кламп — в материале) ---
	UPROPERTY(Config) float FootprintRadiusCm = 15.f;
	UPROPERTY(Config) float FootprintDepthCm = 3.5f;
	UPROPERTY(Config) float FootprintRimCm = 1.0f;
	UPROPERTY(Config) float SlidingDepthCm = 2.5f;
	UPROPERTY(Config) float SlidingRimCm = 1.5f;
	UPROPERTY(Config) float ThumperRingRadiusCm = 140.f;
	UPROPERTY(Config) float ThumperDepthCm = 1.5f;
	UPROPERTY(Config) float ThumperRimCm = 1.2f;
	UPROPERTY(Config) float WormFurrowRadiusCm = 1500.f;
	UPROPERTY(Config) float WormFurrowDepthCm = 45.f;
	UPROPERTY(Config) float WormFurrowRimCm = 12.f;
	UPROPERTY(Config) float WormCraterRadiusCm = 2600.f;
	UPROPERTY(Config) float WormCraterDepthCm = 160.f;
	UPROPERTY(Config) float WormCraterRimCm = 50.f;
	/** Плотный (барабанный) песок — следы мельче. */
	UPROPERTY(Config) float PackedSandDepthScale = 0.5f;

	// --- Скан персонажей ---
	UPROPERTY(Config) float ScanRadiusCm = 6000.f;
	UPROPERTY(Config) float ScanHz = 10.f;
	/** Шаг следа NPC (по смещению), см. */
	UPROPERTY(Config) float NpcStepCm = 60.f;
	/** Поперечное смещение левой/правой стопы от оси движения, см. */
	UPROPERTY(Config) float FootLateralCm = 10.f;
	/** Персонаж, приславший шум "Footstep" не позже этого, сканом не штампуется (нет дублей), с. */
	UPROPERTY(Config) float NoiseFootstepGraceSec = 1.5f;
	/** Скольжение: спуск круче этого (падение высоты / горизонтальный путь, ≈ tg 24°) при скорости ≥ SlideMinSpeed → борозда. */
	UPROPERTY(Config) float SlideSlope = 0.45f;
	UPROPERTY(Config) float SlideMinSpeed = 220.f;

	// --- Червь ---
	/** Голова глубже этого под поверхностью — песок не тревожит, см. */
	UPROPERTY(Config) float WormMaxDisturbDepthCm = 4000.f;

private:
	struct FCharacterTrack
	{
		FVector LastFoot = FVector::ZeroVector;
		float LastNoiseFootstepTime = -1000.f;
		bool bInitialized = false;
		bool bNextLeft = false;
	};

	struct FPendingStamp
	{
		FVector2D Position = FVector2D::ZeroVector;
		float RadiusCm = 0.f;
		float DepthCm = 0.f;
		float RimCm = 0.f;
		float YawDeg = 0.f;
		ERakisStampType Type = ERakisStampType::Footprint;
	};

	bool InitResources();
	bool InitCascade(FRakisTrailCascade& Cascade, const TSoftObjectPtr<UTextureRenderTarget2D>& Asset, int32 FallbackResolution,
		float InWorldSizeCm, float InSnapCm, FName InMPCParameter, float InFadeRateScale, uint32 InAcceptMask);
	void UpdateWindow(FRakisTrailCascade& Cascade, const FVector2D& Focus);
	void WriteWindowToMPC(const FRakisTrailCascade& Cascade, bool bActive);
	void ApplyFade(float DeltaSeconds);
	void FlushStamps();
	void DrawStamps(FRakisTrailCascade& Cascade, int32& InOutMIDIndex);
	UMaterialInstanceDynamic* GetStampMID(int32 Index);

	void HandleNoise(const FRakisNoiseEvent& Event);
	void ScanCharacters(const FVector& Focus);
	void UpdateWorm(const FVector& Focus);
	bool TraceSand(const FVector& Where, const AActor* Ignore, int32& OutSandKind) const;
	void AddFootprint(const FVector& FootPos, float YawDeg, float Depth01, const AActor* Ignore);
	void GetTypeShape(ERakisStampType Type, float& OutDepthCm, float& OutRimCm, float& OutWidthScale) const;
	float ReadMPCScalar(FName Name, float Default) const;
	bool GetFocus(FVector& OutFocus) const;

	UPROPERTY(Transient)
	TArray<FRakisTrailCascade> Cascades;

	UPROPERTY(Transient)
	TArray<TObjectPtr<UMaterialInstanceDynamic>> StampMIDs;

	UPROPERTY(Transient)
	TObjectPtr<UMaterialInterface> StampMaterial;

	UPROPERTY(Transient)
	TObjectPtr<UMaterialInterface> FadeMaterial;

	UPROPERTY(Transient)
	TObjectPtr<UMaterialInterface> CopyMaterial;

	UPROPERTY(Transient)
	TObjectPtr<UMaterialParameterCollection> WeatherMPC;

	TArray<FPendingStamp> Pending;
	TMap<TWeakObjectPtr<ACharacter>, FCharacterTrack> Tracks;

	TWeakObjectPtr<ARakisWorm> Worm;
	FVector2D LastWormStamp = FVector2D::ZeroVector;
	uint8 LastWormState = 0;
	bool bWormStampValid = false;
	float NextWormSearchTime = 0.f;

	TWeakObjectPtr<URakisNoiseSubsystem> NoiseSource;
	FDelegateHandle NoiseHandle;
	float ScanAccum = 0.f;
	float FadeAccum = 0.f;
	float MPCRefreshAccum = 0.f;
	bool bResourcesReady = false;
	bool bTriedInit = false;
	bool bWasEnabled = true;
	bool bWarnedNoMPCParam = false;
};
