// Автотесты core-геймплея Rakis (Session Frontend → Automation → фильтр "Rakis.").
// Проверяются чистые статические функции — без мира и ассетов.

#include "CoreMinimal.h"
#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS

#include "Hydration/RakisHydrationComponent.h"
#include "Noise/RakisNoiseComponent.h"
#include "Noise/RakisNoiseSubsystem.h"
#include "Noise/RakisSandWalkComponent.h"
#include "Worm/RakisWorm.h"
#include "Worm/RakisWormTuning.h"

// Макрос, а не constexpr-переменная: тип флагов менялся между версиями движка (namespace-enum → enum class).
#define RAKIS_TEST_FLAGS (EAutomationTestFlags::EditorContext | EAutomationTestFlags::ClientContext | EAutomationTestFlags::ProductFilter)

// ---------------------------------------------------------------------------------------------
// Ритм походки по песку

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FRakisRhythmRegularityTest, "Rakis.Noise.RhythmRegularity", RAKIS_TEST_FLAGS)

bool FRakisRhythmRegularityTest::RunTest(const FString& Parameters)
{
	// Метроном — регулярность 1 (плохо).
	const TArray<float> Metronome = { 0.5f, 0.5f, 0.5f, 0.5f, 0.5f, 0.5f };
	TestEqual(TEXT("Metronome is fully regular"), URakisSandWalkComponent::ComputeRegularity(Metronome), 1.f, 1.e-4f);

	// Почти ровно — высокая регулярность.
	const TArray<float> Steady = { 0.50f, 0.52f, 0.49f, 0.51f, 0.50f, 0.48f };
	TestTrue(TEXT("Steady walk is regular (> 0.8)"), URakisSandWalkComponent::ComputeRegularity(Steady) > 0.8f);

	// Сбитый ритм (полушаги и паузы) — около нуля (хорошо).
	const TArray<float> Broken = { 0.30f, 0.90f, 0.45f, 1.10f, 0.35f, 0.80f };
	TestTrue(TEXT("Broken rhythm is chaotic (< 0.15)"), URakisSandWalkComponent::ComputeRegularity(Broken) < 0.15f);

	// Монотонность: чем больше разброс, тем ниже регулярность.
	const TArray<float> Mild = { 0.45f, 0.55f, 0.45f, 0.55f, 0.45f, 0.55f };
	const TArray<float> Strong = { 0.35f, 0.65f, 0.35f, 0.65f, 0.35f, 0.65f };
	TestTrue(TEXT("More variance -> less regular"),
		URakisSandWalkComponent::ComputeRegularity(Strong) < URakisSandWalkComponent::ComputeRegularity(Mild));

	// Мало данных — ритма нет.
	TestEqual(TEXT("Empty -> 0"), URakisSandWalkComponent::ComputeRegularity(TArray<float>()), 0.f);
	TestEqual(TEXT("Single interval -> 0"), URakisSandWalkComponent::ComputeRegularity(TArray<float>{ 0.5f }), 0.f);

	// Результат всегда в [0, 1].
	const TArray<float> Wild = { 0.05f, 3.0f, 0.1f, 2.5f };
	const float WildValue = URakisSandWalkComponent::ComputeRegularity(Wild);
	TestTrue(TEXT("Clamped to [0,1]"), WildValue >= 0.f && WildValue <= 1.f);
	return true;
}

// ---------------------------------------------------------------------------------------------
// Шум: громкость шага, спад метра, затухание событий

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FRakisNoiseDecayTest, "Rakis.Noise.DecayAndLoudness", RAKIS_TEST_FLAGS)

bool FRakisNoiseDecayTest::RunTest(const FString& Parameters)
{
	// Спад метра: 0.15/с.
	TestEqual(TEXT("Decay 1s"), URakisNoiseComponent::ComputeDecayed(0.5f, 0.15f, 1.f), 0.35f, 1.e-5f);
	TestEqual(TEXT("Decay never below zero"), URakisNoiseComponent::ComputeDecayed(0.1f, 0.15f, 2.f), 0.f);
	TestEqual(TEXT("Zero dt keeps value"), URakisNoiseComponent::ComputeDecayed(0.42f, 0.15f, 0.f), 0.42f, 1.e-6f);

	// Сумма спадов по шагам = один большой шаг (таймер 10 Гц не накапливает ошибку).
	float Stepped = 0.9f;
	for (int32 i = 0; i < 10; ++i)
	{
		Stepped = URakisNoiseComponent::ComputeDecayed(Stepped, 0.15f, 0.1f);
	}
	TestEqual(TEXT("10 x 0.1s == 1s"), Stepped, URakisNoiseComponent::ComputeDecayed(0.9f, 0.15f, 1.f), 1.e-4f);

	// Громкость шага: камень — ноль, утоптанный песок громче, ритм штрафуется.
	TestEqual(TEXT("Rock is silent"), URakisNoiseComponent::ComputeStepLoudness(0.35f, 0.f, 1.f, 0.6f), 0.f);
	TestEqual(TEXT("Chaotic walk on sand"), URakisNoiseComponent::ComputeStepLoudness(0.35f, 1.f, 0.f, 0.6f), 0.35f, 1.e-5f);
	TestEqual(TEXT("Metronome walk on sand"), URakisNoiseComponent::ComputeStepLoudness(0.35f, 1.f, 1.f, 0.6f), 0.56f, 1.e-5f);
	TestTrue(TEXT("Packed sand louder than sand"),
		URakisNoiseComponent::ComputeStepLoudness(0.35f, 1.4f, 0.5f, 0.6f) > URakisNoiseComponent::ComputeStepLoudness(0.35f, 1.f, 0.5f, 0.6f));
	TestTrue(TEXT("Irregular sand-walk quieter than walk"),
		URakisNoiseComponent::ComputeStepLoudness(0.12f, 1.f, 0.f, 0.6f) < URakisNoiseComponent::ComputeStepLoudness(0.35f, 1.f, 1.f, 0.6f));

	// Вклад события: дистанция и возраст.
	const float Fresh = URakisNoiseSubsystem::ComputeContribution(1.f, 0.f, 1000.f, 0.f, 2.f, 10.f);
	TestEqual(TEXT("Fresh event at source"), Fresh, 1.f, 1.e-5f);
	TestEqual(TEXT("Half radius halves"), URakisNoiseSubsystem::ComputeContribution(1.f, 500.f, 1000.f, 0.f, 2.f, 10.f), 0.5f, 1.e-5f);
	TestEqual(TEXT("Outside radius"), URakisNoiseSubsystem::ComputeContribution(1.f, 1500.f, 1000.f, 0.f, 2.f, 10.f), 0.f);
	TestEqual(TEXT("Too old"), URakisNoiseSubsystem::ComputeContribution(1.f, 0.f, 1000.f, 11.f, 2.f, 10.f), 0.f);
	TestEqual(TEXT("Age = tau -> 1/e"), URakisNoiseSubsystem::ComputeContribution(1.f, 0.f, 1000.f, 2.f, 2.f, 10.f), FMath::Exp(-1.f), 1.e-5f);
	return true;
}

// ---------------------------------------------------------------------------------------------
// Червь: пороги и переходы автомата, угроза

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FRakisWormStateTest, "Rakis.Worm.StateThresholds", RAKIS_TEST_FLAGS)

bool FRakisWormStateTest::RunTest(const FString& Parameters)
{
	const URakisWormTuning& T = *GetDefault<URakisWormTuning>();
	using S = ERakisWormState;

	auto Next = [&T](S Current, TFunctionRef<void(FRakisWormSenseInput&)> Setup)
	{
		FRakisWormSenseInput In;
		Setup(In);
		return ARakisWorm::ComputeNextState(Current, In, T);
	};

	// Dormant
	TestTrue(TEXT("Dormant: quiet stays"), Next(S::Dormant, [&](FRakisWormSenseInput& In) { In.Noise = T.ListenThreshold * 0.9f; }) == S::Dormant);
	TestTrue(TEXT("Dormant: noise >= Listen -> Listening"), Next(S::Dormant, [&](FRakisWormSenseInput& In) { In.Noise = T.ListenThreshold; }) == S::Listening);
	TestTrue(TEXT("Dormant: cooldown deafens"), Next(S::Dormant, [&](FRakisWormSenseInput& In) { In.Noise = 5.f; In.bCooldownActive = true; }) == S::Dormant);

	// Listening
	TestTrue(TEXT("Listening: noise >= Approach -> Approach"), Next(S::Listening, [&](FRakisWormSenseInput& In) { In.Noise = T.ApproachThreshold; }) == S::Approach);
	TestTrue(TEXT("Listening: target on rock -> no approach"), Next(S::Listening, [&](FRakisWormSenseInput& In) { In.Noise = T.ApproachThreshold * 2.f; In.bTargetSafe = true; }) == S::Listening);
	TestTrue(TEXT("Listening: between thresholds stays"), Next(S::Listening, [&](FRakisWormSenseInput& In) { In.Noise = (T.ListenThreshold + T.ApproachThreshold) * 0.5f; }) == S::Listening);
	TestTrue(TEXT("Listening: silence ListenTime -> Dormant"), Next(S::Listening, [&](FRakisWormSenseInput& In) { In.Noise = 0.f; In.TimeSinceLoud = T.ListenTime + 0.1f; }) == S::Dormant);

	// Approach
	TestTrue(TEXT("Approach: close -> Surface"), Next(S::Approach, [&](FRakisWormSenseInput& In) { In.Noise = 1.f; In.DistanceToTarget = T.SurfaceTriggerDistance * 0.5f; }) == S::Surface);
	TestTrue(TEXT("Approach: close but target on rock -> Pass"), Next(S::Approach, [&](FRakisWormSenseInput& In) { In.DistanceToTarget = 0.f; In.bTargetSafe = true; }) == S::Pass);
	TestTrue(TEXT("Approach: far keeps approaching"), Next(S::Approach, [&](FRakisWormSenseInput& In) { In.Noise = 1.f; In.DistanceToTarget = T.SurfaceTriggerDistance * 4.f; }) == S::Approach);
	TestTrue(TEXT("Approach: lost interest -> Pass"), Next(S::Approach, [&](FRakisWormSenseInput& In) { In.DistanceToTarget = 1.e6f; In.TimeSinceLoud = T.ListenTime + 1.f; }) == S::Pass);

	// Surface / Ridden / Pass
	TestTrue(TEXT("Surface: ridden -> Ridden"), Next(S::Surface, [&](FRakisWormSenseInput& In) { In.bRidden = true; }) == S::Ridden);
	TestTrue(TEXT("Surface: after duration -> Pass"), Next(S::Surface, [&](FRakisWormSenseInput& In) { In.TimeInState = T.SurfaceDuration + 0.1f; }) == S::Pass);
	TestTrue(TEXT("Ridden: dismount -> Pass"), Next(S::Ridden, [&](FRakisWormSenseInput& In) { In.bRidden = false; }) == S::Pass);
	TestTrue(TEXT("Pass: during PassTime stays"), Next(S::Pass, [&](FRakisWormSenseInput& In) { In.TimeInState = T.PassTime * 0.5f; }) == S::Pass);
	TestTrue(TEXT("Pass: after PassTime -> Dormant"), Next(S::Pass, [&](FRakisWormSenseInput& In) { In.TimeInState = T.PassTime + 0.1f; }) == S::Dormant);

	// Угроза
	TestEqual(TEXT("Dormant threat is zero"), ARakisWorm::ComputeThreat01(S::Dormant, 0.f, 1.f, 0.f, T), 0.f);
	const float Near = ARakisWorm::ComputeThreat01(S::Approach, 1000.f, 1.f, 0.f, T);
	const float Far = ARakisWorm::ComputeThreat01(S::Approach, T.ThreatMaxDistance, 1.f, 0.f, T);
	TestTrue(TEXT("Approach: near > far"), Near > Far);
	TestTrue(TEXT("Approach threat in (0,1]"), Far > 0.f && Near <= 1.f);
	TestTrue(TEXT("Surface near is near max"), ARakisWorm::ComputeThreat01(S::Surface, 0.f, 0.f, 0.f, T) > 0.95f);
	TestTrue(TEXT("Pass fades out"), ARakisWorm::ComputeThreat01(S::Pass, 0.f, 0.f, T.PassTime, T) < 0.01f);
	TestTrue(TEXT("Listening threat is subtle"), ARakisWorm::ComputeThreat01(S::Listening, 0.f, T.ApproachThreshold, 0.f, T) <= 0.35f + 1.e-4f);

	// Дефолты контракта §2.6.
	TestEqual(TEXT("Contract ListenThreshold"), T.ListenThreshold, 0.25f);
	TestEqual(TEXT("Contract ApproachThreshold"), T.ApproachThreshold, 0.55f);
	TestEqual(TEXT("Contract Length"), T.Length, 36000.f);
	TestEqual(TEXT("Contract Diameter"), T.Diameter, 4000.f);
	return true;
}

// ---------------------------------------------------------------------------------------------
// Влага

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FRakisHydrationRatesTest, "Rakis.Hydration.Rates", RAKIS_TEST_FLAGS)

bool FRakisHydrationRatesTest::RunTest(const FString& Parameters)
{
	auto Delta = [](ERakisExposure Exposure, bool bRun, bool bSealed, float Seconds)
	{
		return URakisHydrationComponent::ComputeMoistureDelta(Exposure, bRun, bSealed, Seconds, 0.06f, 0.02f, 2.0f, 0.35f, 0.05f);
	};

	TestEqual(TEXT("Sun, open mask, walk: -0.06/min"), Delta(ERakisExposure::Sun, false, false, 60.f), -0.06f, 1.e-5f);
	TestEqual(TEXT("Sun, open mask, run: x2"), Delta(ERakisExposure::Sun, true, false, 60.f), -0.12f, 1.e-5f);
	TestEqual(TEXT("Sun, sealed mask: x0.35"), Delta(ERakisExposure::Sun, false, true, 60.f), -0.021f, 1.e-5f);
	TestEqual(TEXT("Shade recovers"), Delta(ERakisExposure::Shade, false, true, 60.f), 0.02f, 1.e-5f);
	TestEqual(TEXT("Shade + run: no recovery"), Delta(ERakisExposure::Shade, true, true, 60.f), 0.f);
	TestEqual(TEXT("Interior recovers"), Delta(ERakisExposure::Interior, false, false, 60.f), 0.05f, 1.e-5f);
	return true;
}

#undef RAKIS_TEST_FLAGS

#endif // WITH_DEV_AUTOMATION_TESTS
