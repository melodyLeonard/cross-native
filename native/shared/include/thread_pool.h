#pragma once

#include <thread>
#include <queue>
#include <future>
#include <mutex>
#include <condition_variable>
#include <functional>
#include <memory>
#include <vector>

namespace crossnative {

/**
 * Task priority levels
 */
enum class Priority {
    IMMEDIATE = 0,  // Run on calling thread if possible
    HIGH = 1,       // Dedicated fast thread
    NORMAL = 2,     // Standard worklet pool
    LOW = 3,        // Background processing
    BACKGROUND = 4  // Lowest priority, can be delayed
};

/**
 * Task wrapper with priority support
 */
struct Task {
    std::function<void()> func;
    Priority priority;
    std::chrono::steady_clock::time_point enqueueTime;
    std::string taskId;
    bool cancelled = false;
    
    // For priority queue ordering (lower number = higher priority)
    bool operator<(const Task& other) const {
        return priority > other.priority; // Invert for min-heap behavior
    }
};

/**
 * ThreadPool - Manages worker threads for async native execution
 * 
 * Features:
 * - Configurable number of threads
 * - Priority queue for task scheduling
 * - Task cancellation support
 * - Work stealing for load balancing
 * - Graceful shutdown
 */
class ThreadPool {
public:
    explicit ThreadPool(size_t numThreads = std::thread::hardware_concurrency());
    ~ThreadPool();
    
    // Submit a task with priority
    template<typename F, typename... Args>
    auto enqueue(Priority priority, F&& f, Args&&... args) 
        -> std::future<typename std::invoke_result_t<F, Args...>> {
        
        using return_type = typename std::invoke_result_t<F, Args...>;
        
        auto task = std::make_shared<std::packaged_task<return_type()>>(
            std::bind(std::forward<F>(f), std::forward<Args>(args)...)
        );
        
        std::future<return_type> result = task->get_future();
        
        {
            std::unique_lock<std::mutex> lock(queueMutex_);
            
            if (stop_) {
                throw std::runtime_error("Cannot enqueue on stopped ThreadPool");
            }
            
            Task t;
            t.func = [task](){ (*task)(); };
            t.priority = priority;
            t.enqueueTime = std::chrono::steady_clock::now();
            t.taskId = generateTaskId();
            
            tasks_.push(std::move(t));
        }
        
        condition_.notify_one();
        return result;
    }
    
    // Convenience methods for common priorities
    template<typename F, typename... Args>
    auto enqueueNormal(F&& f, Args&&... args) {
        return enqueue(Priority::NORMAL, std::forward<F>(f), std::forward<Args>(args)...);
    }
    
    template<typename F, typename... Args>
    auto enqueueHigh(F&& f, Args&&... args) {
        return enqueue(Priority::HIGH, std::forward<F>(f), std::forward<Args>(args)...);
    }
    
    // Cancel all pending tasks for a specific module
    void cancelModule(const std::string& moduleId);
    
    // Cancel a specific task by ID
    bool cancelTask(const std::string& taskId);
    
    // Get current queue size
    size_t queueSize() const;
    
    // Get active thread count
    size_t activeThreads() const;
    
    // Check if pool is running
    bool isRunning() const;

private:
    std::vector<std::thread> workers_;
    std::priority_queue<Task> tasks_;
    mutable std::mutex queueMutex_;
    std::condition_variable condition_;
    std::atomic<bool> stop_;
    std::atomic<size_t> activeCount_;
    std::unordered_map<std::string, std::weak_ptr<std::atomic<bool>>> cancellationTokens_;
    
    static std::string generateTaskId();
    void workerLoop();
};

} // namespace crossnative
