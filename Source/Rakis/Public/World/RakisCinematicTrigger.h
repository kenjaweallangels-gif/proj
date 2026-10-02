#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "RakisCinematicTrigger.generated.h"

class UBoxComponent;
class ULevelSequence;
class ULevelSequencePlayer;
class ALevelSequenceActor;

/** Кат-сцена закончилась (или фоллбек отработал). */
DECLARE_DYNAMIC_MULTICAST_DELEGATE(FRakisOnCinematicFinished);

/**
 * Запуск кат-сцены (LS_WormReveal, LS_HallFinale) с блокировкой ввода и скрытием HUD.
 * - Play() — из StoryDirector (PlayCinematic), Blueprint или автоматически по входу игрока в TriggerBox.
 * - Если ассет последовательности отсутствует (блокаут): через FallbackDuration сек вызывается OnFinished,
 *   а при bFallbackForceWormSurface червь выходит на поверхность у актора с тегом Rakis.Worm.Reveal,
 *   чтобы «выход червя» был виден и без Sequencer.
 */
UCLASS()
class RAKIS_API ARakisCinematicTrigger : public AActor
{
	GENERATED_BODY()

public:
	ARakisCinematicTrigger();

	/** Последовательность (/Game/Rakis/Cinematics/LS_*). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Rakis|Cinematic")
	TSoftObjectPtr<ULevelSequence> Sequence;

	/** Запускать при входе игрока в TriggerBox. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Rakis|Cinematic")
	bool bAutoPlayOnOverlap = false;

	/** Проигрывать только один раз за сессию. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Rakis|Cinematic")
	bool bPlayOnce = true;

	/** Блокировать ввод игрока (ARakisCharacter::SetInputLocked). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Rakis|Cinematic")
	bool bLockInput = true;

	/** Скрыть HUD на время кат-сцены. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Rakis|Cinematic")
	bool bHideHUD = true;

	/** Длительность фоллбека без ассета, сек. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Rakis|Cinematic", meta = (ClampMin = "0.0"))
	float FallbackDuration = 12.f;

	/** В фоллбеке вызвать ARakisWorm::ForceSurface у точки WormRevealTag (для LS_WormReveal). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Rakis|Cinematic")
	bool bFallbackForceWormSurface = true;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Rakis|Cinematic")
	FName WormRevealTag = TEXT("Rakis.Worm.Reveal");

	/** Уничтожить актор после окончания (для созданных в рантайме через PlaySequenceAtRuntime). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Rakis|Cinematic")
	bool bDestroyOnFinish = false;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Rakis|Cinematic")
	TObjectPtr<UBoxComponent> TriggerBox;

	/** Запустить кат-сцену. Повторный вызов во время проигрывания игнорируется. */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Cinematic")
	void Play();

	/** Прервать (пропуск кат-сцены) — сразу вызывает OnFinished. */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Cinematic")
	void Stop();

	UFUNCTION(BlueprintPure, Category = "Rakis|Cinematic")
	bool IsPlaying() const { return bPlaying; }

	UPROPERTY(BlueprintAssignable, Category = "Rakis|Cinematic")
	FRakisOnCinematicFinished OnFinished;

	/**
	 * Создать временный триггер и сразу проиграть последовательность по пути (для StoryDirector: PlayCinematic(Param)).
	 * Актор уничтожается после OnFinished; подписывайтесь на OnFinished у возвращённого актора.
	 */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Cinematic", meta = (WorldContext = "WorldContextObject"))
	static ARakisCinematicTrigger* PlaySequenceAtRuntime(UObject* WorldContextObject, const FSoftObjectPath& SequencePath, bool bForceWormInFallback = true);

protected:
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;
	virtual void NotifyActorBeginOverlap(AActor* OtherActor) override;

private:
	UFUNCTION()
	void HandleSequenceFinished();

	void Finish();
	void SetPlayerCinematicMode(bool bEnable);
	void RunFallbackWorm();

	UPROPERTY(Transient)
	TObjectPtr<ALevelSequenceActor> SequenceActor;

	UPROPERTY(Transient)
	TObjectPtr<ULevelSequencePlayer> SequencePlayer;

	FTimerHandle FallbackTimer;
	bool bPlaying = false;
	bool bHasPlayed = false;
	bool bHUDWasShown = true;
	bool bCinematicModeApplied = false;
};
