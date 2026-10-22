import UIKit
import Capacitor

/// Small UIKit island: real system glass, with the existing web library owning every action.
@objc(LibraryControlsPlugin)
class LibraryControlsPlugin: CAPPlugin, CAPBridgedPlugin, UISearchBarDelegate {
    let identifier = "LibraryControlsPlugin"
    let jsName = "LibraryControls"
    let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "setState", returnType: CAPPluginReturnPromise)]

    private var dock: UIStackView?
    private var buttons: [UIButton] = []
    private var searchBar: UISearchBar?
    private var searchRow: UIStackView?
    private var searchDismissalSurface: UIControl?
    private var searchFilterDot: UIView?
    private var closingSearchView: UIView?
    private var searchActive = false
    private var submittingSearch = false
    private var libraryVisible = false
    private var keyboardInset: CGFloat = 0
    private var session = ""
    private var revision = -1

    @objc func setState(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self, let host = self.bridge?.viewController?.view else {
                call.reject("Library view unavailable")
                return
            }
            let nextRevision = call.getInt("revision") ?? 0
            let nextSession = call.getString("session") ?? ""
            let newSession = nextSession != self.session
            if newSession { self.revision = -1 }
            guard nextRevision > self.revision else { call.resolve(); return }
            self.revision = nextRevision
            self.session = nextSession
            if self.dock == nil { self.makeDock(in: host) }
            if newSession {
                self.setSearchActive(false)
                self.searchBar?.text = call.getString("searchQuery") ?? ""
            }
            let appearance: UIUserInterfaceStyle = call.getString("appearance") == "light" ? .light : .dark
            self.dock?.overrideUserInterfaceStyle = appearance
            self.searchRow?.overrideUserInterfaceStyle = appearance
            self.libraryVisible = call.getBool("visible") ?? false
            if !self.libraryVisible {
                self.closingSearchView?.removeFromSuperview()
                self.closingSearchView = nil
                let wasSearching = self.searchActive
                self.setSearchActive(false)
                self.searchBar?.text = ""
                if wasSearching { self.reportSearch(false, query: "") }
                self.dock?.alpha = 1
            }
            // UIKit owns input even while collapsed. Older queued web acknowledgements
            // must not restore an earlier query between closing and reopening the field.
            self.dock?.isHidden = !self.libraryVisible || self.searchActive
            self.buttons[2].isEnabled = !(call.getBool("addDisabled") ?? true)
            self.updateSearchFilterIndicator(self.searchBar?.text ?? "")
            host.bringSubviewToFront(self.dock!)
            if let search = self.searchRow { host.bringSubviewToFront(search) }
            call.resolve()
        }
    }

    private func makeDock(in host: UIView) {
        let row = UIStackView()
        row.axis = .horizontal
        row.distribution = .equalSpacing
        row.alignment = .center
        row.translatesAutoresizingMaskIntoConstraints = false
        row.isHidden = true
        let actions = ["search", "settings", "add"]
        let labels = ["Search decks", "Settings", "Add deck"]
        for index in 0..<actions.count {
            var configuration: UIButton.Configuration
            if #available(iOS 26.0, *) {
                configuration = .glass()
            } else {
                configuration = .gray()
            }
            configuration.cornerStyle = .capsule
            configuration.contentInsets = .zero
            configuration.baseForegroundColor = .label
            configuration.image = symbol(["magnifyingglass", "gearshape", "plus"][index])
            let button = UIButton(configuration: configuration)
            button.accessibilityLabel = labels[index]
            button.accessibilityIdentifier = "library-\(actions[index])"
            button.widthAnchor.constraint(equalToConstant: 48).isActive = true
            button.heightAnchor.constraint(equalToConstant: 48).isActive = true
            if index == 0 {
                let dot = UIView()
                dot.translatesAutoresizingMaskIntoConstraints = false
                dot.backgroundColor = .label
                dot.layer.cornerRadius = 2
                dot.layer.zPosition = 1
                dot.isHidden = true
                dot.isUserInteractionEnabled = false
                dot.accessibilityElementsHidden = true
                button.addSubview(dot)
                NSLayoutConstraint.activate([
                    dot.widthAnchor.constraint(equalToConstant: 4), dot.heightAnchor.constraint(equalToConstant: 4),
                    dot.topAnchor.constraint(equalTo: button.topAnchor, constant: 10),
                    dot.trailingAnchor.constraint(equalTo: button.trailingAnchor, constant: -9),
                ])
                searchFilterDot = dot
            }
            let action = actions[index]
            button.addAction(UIAction { [weak self] _ in
                guard let self, self.dock?.isHidden == false else { return }
                // Never leave UIKit controls over the next route while the bridge delivers its event.
                if action == "search" {
                    self.setSearchActive(true)
                    self.reportSearch(true)
                } else {
                    self.dock?.isHidden = true
                    self.notifyListeners("action", data: ["session": self.session, "action": action])
                }
            }, for: .touchUpInside)
            row.addArrangedSubview(button)
            buttons.append(button)
        }
        host.addSubview(row)
        let width = row.widthAnchor.constraint(equalTo: host.safeAreaLayoutGuide.widthAnchor, constant: -48)
        width.priority = .defaultHigh
        NSLayoutConstraint.activate([
            row.centerXAnchor.constraint(equalTo: host.safeAreaLayoutGuide.centerXAnchor),
            width,
            row.widthAnchor.constraint(lessThanOrEqualToConstant: 224),
            row.heightAnchor.constraint(equalToConstant: 48),
            row.bottomAnchor.constraint(equalTo: host.keyboardLayoutGuide.topAnchor, constant: -12),
        ])
        dock = row
        makeSearch(in: host)
        makeSearchDismissalSurface(in: host)
        NotificationCenter.default.addObserver(self, selector: #selector(keyboardWillChange(_:)), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
    }

    private func makeSearch(in host: UIView) {
        let search = UISearchBar()
        search.translatesAutoresizingMaskIntoConstraints = false
        search.searchBarStyle = .minimal
        search.placeholder = "Search decks"
        search.returnKeyType = .search
        search.autocapitalizationType = .none
        search.autocorrectionType = .no
        search.tintColor = .label
        search.searchTextField.textColor = .label
        search.searchTextField.font = .preferredFont(forTextStyle: .body)
        search.searchTextField.adjustsFontForContentSizeCategory = true
        search.searchTextField.accessibilityIdentifier = "library-search-field"
        search.delegate = self
        var closeConfiguration: UIButton.Configuration
        if #available(iOS 26.0, *) { closeConfiguration = .glass() }
        else { closeConfiguration = .gray() }
        closeConfiguration.cornerStyle = .capsule
        closeConfiguration.baseForegroundColor = .label
        closeConfiguration.image = symbol("xmark")
        let close = UIButton(configuration: closeConfiguration)
        close.accessibilityLabel = "Clear and close search"
        close.widthAnchor.constraint(equalToConstant: 48).isActive = true
        close.heightAnchor.constraint(equalToConstant: 48).isActive = true
        close.addAction(UIAction { [weak self] _ in self?.closeSearch() }, for: .touchUpInside)
        let row = UIStackView(arrangedSubviews: [search, close])
        row.axis = .horizontal
        row.alignment = .center
        row.spacing = 4
        row.isHidden = true
        row.accessibilityIdentifier = "library-search-row"
        row.translatesAutoresizingMaskIntoConstraints = false
        host.addSubview(row)
        NSLayoutConstraint.activate([
            row.leadingAnchor.constraint(equalTo: host.safeAreaLayoutGuide.leadingAnchor, constant: 12),
            row.trailingAnchor.constraint(equalTo: host.safeAreaLayoutGuide.trailingAnchor, constant: -20),
            row.heightAnchor.constraint(equalToConstant: 52),
            search.heightAnchor.constraint(equalToConstant: 52),
            row.bottomAnchor.constraint(equalTo: host.keyboardLayoutGuide.topAnchor, constant: -8),
        ])
        searchBar = search
        searchRow = row
    }

    /// Own the first outside press directly, above WebKit's competing touch handlers.
    /// The original touch stays with this control, so it cannot also open a deck.
    private func makeSearchDismissalSurface(in host: UIView) {
        guard let searchRow else { return }
        let surface = UIControl()
        surface.translatesAutoresizingMaskIntoConstraints = false
        surface.backgroundColor = .clear
        surface.isHidden = true
        surface.accessibilityElementsHidden = true
        surface.addAction(UIAction { [weak self] _ in self?.closeSearch(clearQuery: false) }, for: .touchDown)
        host.insertSubview(surface, belowSubview: searchRow)
        NSLayoutConstraint.activate([
            surface.leadingAnchor.constraint(equalTo: host.leadingAnchor),
            surface.trailingAnchor.constraint(equalTo: host.trailingAnchor),
            surface.topAnchor.constraint(equalTo: host.topAnchor),
            surface.bottomAnchor.constraint(equalTo: host.bottomAnchor),
        ])
        searchDismissalSurface = surface
    }

    private func setSearchActive(_ active: Bool) {
        guard searchActive != active else { return }
        searchActive = active
        submittingSearch = false
        searchRow?.isHidden = !active
        searchDismissalSurface?.isHidden = !active
        dock?.isHidden = active || !libraryVisible
        if active {
            closingSearchView?.removeFromSuperview()
            closingSearchView = nil
            dock?.alpha = 1
            searchBar?.becomeFirstResponder()
        } else {
            searchBar?.searchTextField.resignFirstResponder()
        }
    }

    func searchBar(_ searchBar: UISearchBar, textDidChange searchText: String) {
        notifyListeners("action", data: ["session": session, "action": "query", "query": searchText])
    }

    func searchBarCancelButtonClicked(_ searchBar: UISearchBar) {
        closeSearch()
    }

    private func closeSearch(clearQuery: Bool = true) {
        guard searchActive else { return }
        animateSearchClosed()
        if clearQuery { searchBar?.text = "" }
        setSearchActive(false)
        updateSearchFilterIndicator(searchBar?.text ?? "")
        reportSearch(false)
    }

    private func reportSearch(_ open: Bool, query: String? = nil) {
        notifyListeners("action", data: ["session": session, "action": "search", "open": open, "query": query ?? searchBar?.text ?? ""])
    }

    private func updateSearchFilterIndicator(_ query: String) {
        let filtered = !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        searchFilterDot?.isHidden = !filtered
        buttons.first?.accessibilityValue = filtered ? "Filter active" : nil
    }

    /// Clip a temporary image of the field into the search control as the keyboard leaves.
    /// The real input resigns immediately; no blur, shader or delayed action is involved.
    private func animateSearchClosed() {
        guard let host = bridge?.viewController?.view, let row = searchRow,
              let dock, let searchButton = buttons.first,
              let image = row.snapshotView(afterScreenUpdates: false) else { return }
        host.layoutIfNeeded()
        closingSearchView?.removeFromSuperview()
        let clip = UIView()
        clip.isUserInteractionEnabled = false
        clip.translatesAutoresizingMaskIntoConstraints = false
        clip.clipsToBounds = true
        clip.layer.cornerRadius = 26
        image.frame = row.bounds
        clip.addSubview(image)
        host.addSubview(clip)
        closingSearchView = clip
        let leading = clip.leadingAnchor.constraint(equalTo: host.safeAreaLayoutGuide.leadingAnchor,
                                                     constant: row.frame.minX - host.safeAreaLayoutGuide.layoutFrame.minX)
        let width = clip.widthAnchor.constraint(equalToConstant: row.bounds.width)
        let height = clip.heightAnchor.constraint(equalToConstant: 52)
        let bottom = clip.bottomAnchor.constraint(equalTo: host.keyboardLayoutGuide.topAnchor, constant: -8)
        NSLayoutConstraint.activate([leading, width, height, bottom])
        host.layoutIfNeeded()
        let destinationX = searchButton.convert(searchButton.bounds, to: host).minX
        dock.alpha = 0
        let reducedMotion = UIAccessibility.isReduceMotionEnabled
        if !reducedMotion {
            leading.constant = destinationX - host.safeAreaLayoutGuide.layoutFrame.minX
            width.constant = 48
            height.constant = 48
            bottom.constant = -12
        }
        UIView.animate(withDuration: reducedMotion ? 0.12 : 0.22, delay: 0,
                       options: [.curveEaseInOut, .beginFromCurrentState, .allowUserInteraction]) {
            clip.alpha = 0
            dock.alpha = 1
            host.layoutIfNeeded()
        } completion: { [weak self, weak clip] _ in
            clip?.removeFromSuperview()
            if self?.closingSearchView === clip { self?.closingSearchView = nil }
        }
    }

    func searchBarSearchButtonClicked(_ searchBar: UISearchBar) {
        // Search submits the current filter; it must not reset the user's query.
        submittingSearch = true
        if !searchBar.searchTextField.resignFirstResponder() { submittingSearch = false }
    }

    func searchBarTextDidBeginEditing(_ searchBar: UISearchBar) {
        submittingSearch = false
    }

    func searchBarTextDidEndEditing(_ searchBar: UISearchBar) {
        if submittingSearch { submittingSearch = false; return }
        // Focus can end without our outside handler (for example keyboard dismissal).
        closeSearch(clearQuery: false)
    }

    @objc private func keyboardWillChange(_ notification: Notification) {
        guard searchActive || keyboardInset > 0, let host = bridge?.viewController?.view,
              let info = notification.userInfo,
              let frame = info[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
        let localFrame = host.convert(frame, from: nil)
        let intersection = host.bounds.intersection(localFrame)
        // Floating keyboards do not occlude the whole bottom edge.
        let inset = intersection.width > host.bounds.width / 2 && localFrame.maxY >= host.bounds.maxY
            ? max(0, host.bounds.maxY - localFrame.minY) : 0
        keyboardInset = inset
        let duration = ((info[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double) ?? 0.25) * 1000
        notifyListeners("action", data: ["session": session, "action": "keyboard", "inset": inset, "duration": duration])
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    private func symbol(_ name: String) -> UIImage? {
        UIImage(systemName: name, withConfiguration: UIImage.SymbolConfiguration(pointSize: 20, weight: .medium))
    }

}
