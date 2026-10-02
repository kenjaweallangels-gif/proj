#pragma once

#include "CoreMinimal.h"
#include "UObject/ObjectPtr.h"
#include "UObject/SoftObjectPath.h"
#include "UObject/SoftObjectPtr.h"

class ACharacter;
class UStaticMeshComponent;
class UMaterialInstanceDynamic;
class UAnimInstance;
struct FRandomStream;

/**
 * Общие для горожан и спутников визуальные утилиты (только для модуля, не публичный API).
 * Всё null-safe: на чистом блокауте без контента персонаж — серо-охровый «цилиндр»-заглушка.
 */
namespace RakisAIVisuals
{
	/** Путь к движковому цилиндру-заглушке. */
	extern const TCHAR* PlaceholderMeshPath;

	/**
	 * Назначить скелетный меш: сначала ArchetypeMeshPath (может быть пустым), затем FallbackMesh.
	 * Если меш назначен — анимкласс: AnimClass, иначе (для фоллбек-меша) FallbackAnim.
	 * Если меш не найден — показывает Placeholder (цилиндр по капсуле).
	 * @return true, если назначен скелетный меш.
	 */
	bool ApplyBody(ACharacter* Character, const FString& ArchetypeMeshPath, const FSoftObjectPath& FallbackMesh,
		const TSoftClassPtr<UAnimInstance>& AnimClass, const TSoftClassPtr<UAnimInstance>& FallbackAnim,
		UStaticMeshComponent* Placeholder);

	/**
	 * Покрасить одежду: на каждый материал скелетного меша (или заглушки) создаётся MID и выставляется
	 * вектор ParamName (у заглушки дополнительно "Color" — параметр BasicShapeMaterial).
	 */
	void ApplyTint(ACharacter* Character, UStaticMeshComponent* Placeholder, const FLinearColor& Color, FName ParamName,
		TArray<TObjectPtr<UMaterialInstanceDynamic>>& OutMIDs);

	/** Выбрать цвет из палитры "#RRGGBB;#RRGGBB;..." (sRGB → linear). */
	FLinearColor PickPaletteColor(const FString& Palette, FRandomStream& Rng, const FLinearColor& Default);

	/** Однократное предупреждение по ключу (общий для модуля AI набор). */
	void WarnOnce(const FString& Key, const FString& Message);
}
