#pragma once

#include "CoreMinimal.h"
#include "UObject/SoftObjectPtr.h"

/**
 * Утилиты безопасной загрузки soft-ассетов (контракт §2.5: любой код обязан переживать
 * отсутствие ассета — null-check + одно предупреждение в лог).
 */
namespace RakisAssets
{
	/** Пишет UE_LOG(LogRakis, Warning) не более одного раза на ключ (ключ — обычно путь ассета). */
	RAKIS_API void WarnOnce(const FString& Key, const FString& Message);

	/**
	 * Синхронно грузит soft-ассет. Если ссылка пустая и bRequired — одно предупреждение;
	 * если путь задан, но ассета нет — одно предупреждение. Возвращает nullptr при неудаче.
	 */
	template <typename T>
	T* Load(const TSoftObjectPtr<T>& Ptr, const TCHAR* Context, bool bRequired = true)
	{
		if (Ptr.IsNull())
		{
			if (bRequired)
			{
				WarnOnce(FString::Printf(TEXT("%s::<null>"), Context),
					FString::Printf(TEXT("%s: soft reference is not set, feature disabled"), Context));
			}
			return nullptr;
		}

		T* Obj = Ptr.LoadSynchronous();
		if (!Obj)
		{
			WarnOnce(Ptr.ToString(),
				FString::Printf(TEXT("%s: asset '%s' is missing, using fallback"), Context, *Ptr.ToString()));
		}
		return Obj;
	}
}
