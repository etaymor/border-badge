import { useOnboardingStore } from '@stores/onboardingStore';

describe('onboardingStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useOnboardingStore.setState({
      motivationTags: [],
      selectedCountries: [],
      currentStep: 0,
      personaTags: [],
      homeCountry: null,
      dreamDestination: null,
      bucketListCountries: [],
      visitedContinents: [],
    });
  });

  it('starts with initial state', () => {
    const state = useOnboardingStore.getState();

    expect(state.motivationTags).toEqual([]);
    expect(state.selectedCountries).toEqual([]);
    expect(state.currentStep).toBe(0);
    expect(state.personaTags).toEqual([]);
    expect(state.homeCountry).toBeNull();
    expect(state.dreamDestination).toBeNull();
    expect(state.bucketListCountries).toEqual([]);
    expect(state.visitedContinents).toEqual([]);
  });

  describe('motivationTags', () => {
    it('sets motivation tags', () => {
      const tags = ['Adventure', 'Culture', 'Food'];

      useOnboardingStore.getState().setMotivationTags(tags);

      expect(useOnboardingStore.getState().motivationTags).toEqual(tags);
    });

    it('toggles motivation tag on', () => {
      useOnboardingStore.getState().toggleMotivationTag('Adventure');

      expect(useOnboardingStore.getState().motivationTags).toContain('Adventure');
    });

    it('toggles motivation tag off', () => {
      useOnboardingStore.setState({ motivationTags: ['Adventure', 'Culture'] });

      useOnboardingStore.getState().toggleMotivationTag('Adventure');

      expect(useOnboardingStore.getState().motivationTags).not.toContain('Adventure');
      expect(useOnboardingStore.getState().motivationTags).toContain('Culture');
    });
  });

  describe('personaTags', () => {
    it('sets persona tags', () => {
      const tags = ['Explorer', 'Foodie'];

      useOnboardingStore.getState().setPersonaTags(tags);

      expect(useOnboardingStore.getState().personaTags).toEqual(tags);
    });

    it('toggles persona tag on', () => {
      useOnboardingStore.getState().togglePersonaTag('Explorer');

      expect(useOnboardingStore.getState().personaTags).toContain('Explorer');
    });

    it('toggles persona tag off', () => {
      useOnboardingStore.setState({ personaTags: ['Explorer', 'Foodie'] });

      useOnboardingStore.getState().togglePersonaTag('Explorer');

      expect(useOnboardingStore.getState().personaTags).not.toContain('Explorer');
      expect(useOnboardingStore.getState().personaTags).toContain('Foodie');
    });
  });

  describe('selectedCountries', () => {
    it('sets selected countries', () => {
      const countries = ['US', 'CA', 'MX'];

      useOnboardingStore.getState().setSelectedCountries(countries);

      expect(useOnboardingStore.getState().selectedCountries).toEqual(countries);
    });

    it('toggles country on', () => {
      useOnboardingStore.getState().toggleCountry('US');

      expect(useOnboardingStore.getState().selectedCountries).toContain('US');
    });

    it('toggles country off', () => {
      useOnboardingStore.setState({ selectedCountries: ['US', 'CA'] });

      useOnboardingStore.getState().toggleCountry('US');

      expect(useOnboardingStore.getState().selectedCountries).not.toContain('US');
      expect(useOnboardingStore.getState().selectedCountries).toContain('CA');
    });
  });

  describe('homeCountry', () => {
    it('sets home country', () => {
      useOnboardingStore.getState().setHomeCountry('US');

      expect(useOnboardingStore.getState().homeCountry).toBe('US');
    });

    it('clears home country', () => {
      useOnboardingStore.setState({ homeCountry: 'US' });

      useOnboardingStore.getState().setHomeCountry(null);

      expect(useOnboardingStore.getState().homeCountry).toBeNull();
    });
  });

  describe('dreamDestination', () => {
    it('sets dream destination', () => {
      useOnboardingStore.getState().setDreamDestination('JP');

      expect(useOnboardingStore.getState().dreamDestination).toBe('JP');
    });

    it('clears dream destination', () => {
      useOnboardingStore.setState({ dreamDestination: 'JP' });

      useOnboardingStore.getState().setDreamDestination(null);

      expect(useOnboardingStore.getState().dreamDestination).toBeNull();
    });
  });

  describe('bucketListCountries', () => {
    it('toggles bucket list country on', () => {
      useOnboardingStore.getState().toggleBucketListCountry('JP');

      expect(useOnboardingStore.getState().bucketListCountries).toContain('JP');
    });

    it('toggles bucket list country off', () => {
      useOnboardingStore.setState({ bucketListCountries: ['JP', 'IT'] });

      useOnboardingStore.getState().toggleBucketListCountry('JP');

      expect(useOnboardingStore.getState().bucketListCountries).not.toContain('JP');
      expect(useOnboardingStore.getState().bucketListCountries).toContain('IT');
    });
  });

  describe('visitedContinents', () => {
    it('adds visited continent', () => {
      useOnboardingStore.getState().addVisitedContinent('Europe');

      expect(useOnboardingStore.getState().visitedContinents).toContain('Europe');
    });

    it('does not add duplicate continent', () => {
      useOnboardingStore.setState({ visitedContinents: ['Europe'] });

      useOnboardingStore.getState().addVisitedContinent('Europe');

      expect(useOnboardingStore.getState().visitedContinents).toEqual(['Europe']);
    });

    it('removes visited continent', () => {
      useOnboardingStore.setState({ visitedContinents: ['Europe', 'Asia'] });

      useOnboardingStore.getState().removeVisitedContinent('Europe');

      expect(useOnboardingStore.getState().visitedContinents).not.toContain('Europe');
      expect(useOnboardingStore.getState().visitedContinents).toContain('Asia');
    });
  });

  describe('currentStep', () => {
    it('sets current step', () => {
      useOnboardingStore.getState().setCurrentStep(2);

      expect(useOnboardingStore.getState().currentStep).toBe(2);
    });
  });

  describe('reset', () => {
    it('resets all state to initial values', () => {
      useOnboardingStore.setState({
        motivationTags: ['Adventure', 'Culture'],
        selectedCountries: ['US', 'CA'],
        currentStep: 2,
        personaTags: ['Explorer'],
        homeCountry: 'US',
        dreamDestination: 'JP',
        bucketListCountries: ['JP', 'IT'],
        visitedContinents: ['Europe', 'Asia'],
      });

      useOnboardingStore.getState().reset();

      const state = useOnboardingStore.getState();
      expect(state.motivationTags).toEqual([]);
      expect(state.selectedCountries).toEqual([]);
      expect(state.currentStep).toBe(0);
      expect(state.personaTags).toEqual([]);
      expect(state.homeCountry).toBeNull();
      expect(state.dreamDestination).toBeNull();
      expect(state.bucketListCountries).toEqual([]);
      expect(state.visitedContinents).toEqual([]);
    });
  });
});
