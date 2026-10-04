// Автотесты следов на песке (Session Frontend → Automation → фильтр "Rakis.Sand").
// Только чистые статические функции URakisSandTrailSubsystem — без мира, RT и ассетов.

#include "CoreMinimal.h"
#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS

#include "Sand/RakisSandTrailSubsystem.h"

#define RAKIS_SAND_TEST_FLAGS (EAutomationTestFlags::EditorContext | EAutomationTestFlags::ClientContext | EAutomationTestFlags::ProductFilter)

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FRakisSandTrailMappingTest, "Rakis.Sand.WindowMapping", RAKIS_SAND_TEST_FLAGS)

bool FRakisSandTrailMappingTest::RunTest(const FString& Parameters)
{
	// Центр окна → центр RT; край окна → край RT (то же отображение, что в SandTrail.ush).
	const FVector2D Origin(1000.0, -2000.0);
	const FVector2D Center = URakisSandTrailSubsystem::WorldToPixel(Origin, Origin, 4096.f, 2048);
	TestEqual(TEXT("Origin maps to RT center X"), Center.X, 1024.0, 1.e-6);
	TestEqual(TEXT("Origin maps to RT center Y"), Center.Y, 1024.0, 1.e-6);
	const FVector2D Corner = URakisSandTrailSubsystem::WorldToPixel(Origin + FVector2D(2048.0, 2048.0), Origin, 4096.f, 2048);
	TestEqual(TEXT("+Half window maps to RT edge"), Corner.X, 2048.0, 1.e-6);
	// 2 см/тексель: смещение на 2 см = 1 пиксель.
	const FVector2D OnePx = URakisSandTrailSubsystem::WorldToPixel(Origin + FVector2D(2.0, 0.0), Origin, 4096.f, 2048);
	TestEqual(TEXT("2 cm = 1 px in near cascade"), OnePx.X - Center.X, 1.0, 1.e-6);
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FRakisSandTrailSnapTest, "Rakis.Sand.Snap", RAKIS_SAND_TEST_FLAGS)

bool FRakisSandTrailSnapTest::RunTest(const FString& Parameters)
{
	// Шаг рецентровки кратен текселю — скролл копией без пересэмплинга.
	const float Texel = 20480.f / 1024.f;
	const float Snap = URakisSandTrailSubsystem::SnapToTexel(2555.f, Texel);
	TestEqual(TEXT("Snap is a texel multiple"), FMath::Fmod(Snap, Texel), 0.f, 1.e-3f);
	TestTrue(TEXT("Snap is at least one texel"), URakisSandTrailSubsystem::SnapToTexel(0.f, Texel) >= Texel);

	const FVector2D Origin = URakisSandTrailSubsystem::ComputeSnappedOrigin(FVector2D(1300.0, -260.0), 512.f);
	TestEqual(TEXT("Snapped X"), Origin.X, 1536.0, 1.e-6);
	TestEqual(TEXT("Snapped Y"), Origin.Y, -512.0, 1.e-6);

	// Гистерезис: внутри шага — без рецентровки, за шагом — рецентровка.
	TestFalse(TEXT("No recenter inside snap"), URakisSandTrailSubsystem::NeedsRecenter(FVector2D(500.0, 0.0), FVector2D::ZeroVector, 512.f));
	TestTrue(TEXT("Recenter past snap"), URakisSandTrailSubsystem::NeedsRecenter(FVector2D(0.0, -513.0), FVector2D::ZeroVector, 512.f));
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FRakisSandTrailFadeTest, "Rakis.Sand.WindFade", RAKIS_SAND_TEST_FLAGS)

bool FRakisSandTrailFadeTest::RunTest(const FString& Parameters)
{
	// Штиль: за полураспад остаётся половина.
	const float Calm = URakisSandTrailSubsystem::ComputeFadeAlpha(120.f, 0.f, 0.f, 120.f, 6.f, 8.f);
	TestEqual(TEXT("Calm half-life"), Calm, 0.5f, 1.e-3f);
	// Ветер и буря ускоряют заживление; без времени — ничего не стирается.
	const float Windy = URakisSandTrailSubsystem::ComputeFadeAlpha(1.f, 12.f, 0.f, 120.f, 6.f, 8.f);
	const float Still = URakisSandTrailSubsystem::ComputeFadeAlpha(1.f, 0.f, 0.f, 120.f, 6.f, 8.f);
	const float Storm = URakisSandTrailSubsystem::ComputeFadeAlpha(1.f, 12.f, 1.f, 120.f, 6.f, 8.f);
	TestTrue(TEXT("Wind heals faster"), Windy > Still);
	TestTrue(TEXT("Storm heals much faster"), Storm > Windy * 3.f);
	TestEqual(TEXT("Zero dt"), URakisSandTrailSubsystem::ComputeFadeAlpha(0.f, 10.f, 1.f, 120.f, 6.f, 8.f), 0.f);
	return true;
}

#undef RAKIS_SAND_TEST_FLAGS

#endif // WITH_DEV_AUTOMATION_TESTS
