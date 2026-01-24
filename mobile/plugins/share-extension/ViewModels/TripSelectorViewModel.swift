/**
 * TripSelectorViewModel - Trip list and creation management
 */

import SwiftUI
import Combine

@MainActor
class TripSelectorViewModel: ObservableObject {
    // MARK: - Published State

    @Published var trips: [Trip] = []
    @Published var countries: [Country] = []
    @Published var uncategorizedTrip: Trip?  // "Saved Places" system trip
    @Published var isLoading: Bool = false
    @Published var isCreating: Bool = false
    @Published var error: String?

    // MARK: - Private State

    private let apiClient = APIClient()

    // MARK: - Computed Properties

    /// Filter trips by country code if provided
    func filteredTrips(countryCode: String?) -> [Trip] {
        guard let code = countryCode else {
            return trips
        }
        return trips.filter { $0.countryCode == code }
    }

    /// Check if there are trips matching the country
    func hasTripsForCountry(_ countryCode: String?) -> Bool {
        !filteredTrips(countryCode: countryCode).isEmpty
    }

    // MARK: - Public API

    /// Load trips, countries, and uncategorized trip
    func load() {
        isLoading = true
        error = nil

        Task {
            do {
                // Load trips and countries (required)
                async let tripsTask = apiClient.getTrips()
                async let countriesTask = apiClient.getCountries()

                let (loadedTrips, loadedCountries) = try await (tripsTask, countriesTask)

                trips = loadedTrips.sorted { ($0.createdAt ?? .distantPast) > ($1.createdAt ?? .distantPast) }
                countries = loadedCountries.sorted { $0.name < $1.name }
                NSLog("[Atlasi] Loaded \(trips.count) trips and \(countries.count) countries")

                // Load uncategorized trip separately (optional - don't fail if this errors)
                do {
                    let loaded = try await apiClient.getUncategorizedTrip()
                    uncategorizedTrip = loaded
                    NSLog("[Atlasi] Loaded uncategorized trip: \(loaded.id) - \(loaded.name)")
                } catch {
                    NSLog("[Atlasi] Failed to load uncategorized trip: \(error)")
                    // Continue without uncategorized trip
                }

                isLoading = false

            } catch {
                NSLog("[Atlasi] Failed to load trips/countries: \(error)")
                self.error = "Failed to load trips"
                isLoading = false
            }
        }
    }

    /// Create a new trip
    func createTrip(name: String, countryCode: String) async -> Trip? {
        isCreating = true
        error = nil

        do {
            let newTrip = try await apiClient.createTrip(name: name, countryCode: countryCode)

            // Add to the beginning of the list
            trips.insert(newTrip, at: 0)
            isCreating = false

            return newTrip

        } catch {
            self.error = "Failed to create trip"
            isCreating = false
            return nil
        }
    }

    /// Find a matching trip for a country code
    func findMatchingTrip(for countryCode: String?) -> Trip? {
        guard let code = countryCode else { return nil }
        return trips.first { $0.countryCode == code }
    }

    /// Get country name for a code
    func countryName(for code: String) -> String {
        countries.first { $0.code == code }?.name ?? code
    }

    /// Get country by code
    func country(for code: String) -> Country? {
        countries.first { $0.code == code }
    }
}
